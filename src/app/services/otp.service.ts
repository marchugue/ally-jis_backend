// src/app/services/otp.service.ts
//
// SERVICE LAYER — OTP business logic.
// Handles generate, verify, resend for 6-digit email OTP codes.

import crypto from 'crypto';
import bcrypt from 'bcrypt';
import * as otpModel from '../models/otp.model';
import { sendOtpEmail } from '../utils/mailer';
import { HttpError } from '../types/auth.types';
import { env } from '../../config/env';
import { supabaseAdmin } from '../../config/supabase';

const BCRYPT_ROUNDS = 10;

/**
 * Resend cooldown in seconds — users must wait this long between resend requests.
 * Configurable via OTP_RESEND_COOLDOWN_SECONDS env var (default: 60 seconds).
 */
const RESEND_COOLDOWN_SECONDS = Number(process.env.OTP_RESEND_COOLDOWN_SECONDS ?? 60);

/**
 * Maximum consecutive failed verification attempts before locking the OTP row.
 * Configurable via OTP_MAX_VERIFY_ATTEMPTS env var (default: 5).
 */
const MAX_VERIFY_ATTEMPTS = Number(process.env.OTP_MAX_VERIFY_ATTEMPTS ?? 5);

/**
 * Generates a cryptographically random 6-digit numeric OTP using
 * crypto.randomInt to avoid Math.random bias.
 */
function generateOtpCode(): string {
  return String(crypto.randomInt(100000, 999999));
}

/**
 * Computes resend cooldown seconds remaining.
 * Returns 0 when the user can resend immediately.
 */
function resendCooldownRemaining(lastResentAt: string | null, createdAt: string): number {
  // First resend is gated against the OTP creation time (not last_resent_at)
  const reference = lastResentAt ?? createdAt;
  const referenceMs = new Date(reference).getTime();
  const elapsed = (Date.now() - referenceMs) / 1000;
  const remaining = RESEND_COOLDOWN_SECONDS - elapsed;
  return remaining > 0 ? Math.ceil(remaining) : 0;
}

/**
 * Generates a new OTP, stores its hash in `email_otps`, and sends the email.
 * Resets resend_count and verify_attempts to 0 (fresh generation).
 * Safe to call on both initial send and subsequent fresh generations.
 */
export async function generateAndSendOtp(userId: string, email: string): Promise<void> {
  const code = generateOtpCode();
  const hash = await bcrypt.hash(code, BCRYPT_ROUNDS);
  const expiresAt = new Date(Date.now() + env.OTP_EXPIRY_MINUTES * 60 * 1000);

  await otpModel.upsertOtp({
    userId,
    email,
    otpHash: hash,
    expiresAt,
    resendCount: 0,
    lastResentAt: null,
    verifyAttempts: 0,
  });

  await sendOtpEmail({ to: email, otpCode: code, expiresInMinutes: env.OTP_EXPIRY_MINUTES });
}

/**
 * Resends the OTP — generates a fresh code and increments resend_count.
 *
 * Guards:
 * - Already verified → 409
 * - Resend limit reached → 429
 * - Cooldown not elapsed → 429 with secondsRemaining
 */
export async function resendOtp(userId: string): Promise<{
  resendCount: number;
  resendLimit: number;
  resendAttemptsLeft: number;
  resendCooldownSeconds: number;
  expiresAt: string;
}> {
  const row = await otpModel.findOtpByUserId(userId);

  if (!row) {
    throw new HttpError('No pending verification found. Please register again.', 404);
  }

  if (row.verified_at) {
    throw new HttpError('Your email is already verified. Please log in.', 409);
  }

  if (row.resend_count >= env.OTP_MAX_RESENDS) {
    throw new HttpError(
      `You have reached the maximum of ${env.OTP_MAX_RESENDS} resend attempts. Please wait for your current code to expire, then register again if needed, or contact support.`,
      429
    );
  }

  // Enforce resend cooldown
  const cooldownLeft = resendCooldownRemaining(row.last_resent_at, row.created_at);
  if (cooldownLeft > 0) {
    const err = new HttpError(
      `Please wait ${cooldownLeft} second${cooldownLeft !== 1 ? 's' : ''} before requesting another code.`,
      429
    ) as any;
    err.resendCooldownSeconds = cooldownLeft;
    throw err;
  }

  const newResendCount = row.resend_count + 1;

  // Generate a fresh code and hash, reset verify_attempts on each resend
  const code = generateOtpCode();
  const hash = await bcrypt.hash(code, BCRYPT_ROUNDS);
  const expiresAt = new Date(Date.now() + env.OTP_EXPIRY_MINUTES * 60 * 1000);

  await otpModel.upsertOtp({
    userId,
    email: row.email,
    otpHash: hash,
    expiresAt,
    resendCount: newResendCount,
    lastResentAt: new Date(),
    verifyAttempts: 0,
  });

  await sendOtpEmail({ to: row.email, otpCode: code, expiresInMinutes: env.OTP_EXPIRY_MINUTES });

  const attemptsLeft = env.OTP_MAX_RESENDS - newResendCount;
  return {
    resendCount: newResendCount,
    resendLimit: env.OTP_MAX_RESENDS,
    resendAttemptsLeft: attemptsLeft,
    resendCooldownSeconds: RESEND_COOLDOWN_SECONDS,
    expiresAt: expiresAt.toISOString(),
  };
}

/**
 * Verifies the submitted OTP code.
 *
 * Guards:
 * - No row → 404
 * - Already verified → idempotent success
 * - Expired → 400 with clear message
 * - Too many failed attempts → 429 lock
 * - Wrong code → 400, increments verify_attempts
 *
 * On success:
 *   1. Resets verify_attempts to 0.
 *   2. Marks the OTP row as verified.
 *   3. Confirms the email in Supabase Auth (email_confirmed_at).
 */
export async function verifyOtp(userId: string, code: string): Promise<void> {
  const row = await otpModel.findOtpByUserId(userId);

  if (!row) {
    throw new HttpError('No pending verification found. Please request a new code.', 404);
  }

  if (row.verified_at) {
    // Already verified — idempotent success
    return;
  }

  // Check attempt lockout BEFORE checking expiry so we surface the most actionable error
  const currentAttempts = row.verify_attempts ?? 0;
  if (currentAttempts >= MAX_VERIFY_ATTEMPTS) {
    throw new HttpError(
      `Too many incorrect attempts. Please use "Resend code" to get a new verification code.`,
      429
    );
  }

  if (new Date() > new Date(row.expires_at)) {
    throw new HttpError(
      'This verification code has expired. Please request a new one using the "Resend code" button.',
      400
    );
  }

  const matches = await bcrypt.compare(code, row.otp_hash);
  if (!matches) {
    // Track attempt and surface remaining tries
    const newAttempts = await otpModel.incrementVerifyAttempts(userId);
    const attemptsLeft = MAX_VERIFY_ATTEMPTS - newAttempts;
    if (attemptsLeft <= 0) {
      throw new HttpError(
        'Too many incorrect attempts. Please use "Resend code" to get a new verification code.',
        429
      );
    }
    const err = new HttpError(
      `Incorrect code. ${attemptsLeft} attempt${attemptsLeft !== 1 ? 's' : ''} remaining.`,
      400
    ) as any;
    err.verifyAttemptsLeft = attemptsLeft;
    throw err;
  }

  // Success — reset counters, mark verified, confirm in Supabase
  await otpModel.resetVerifyAttempts(userId);
  await otpModel.markOtpVerified(userId);
  await confirmEmailInSupabase(userId);
}

/**
 * Marks auth.users.email_confirmed_at for the given user id.
 * Called after successful OTP verification.
 */
async function confirmEmailInSupabase(userId: string): Promise<void> {
  const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, {
    email_confirm: true,
  });
  if (error) throw error;
}

/**
 * Returns the full OTP status for a user — used by frontends to render
 * the OTP screen accurately (countdown, resend state, attempt count) without exposing the hash.
 */
export async function getOtpStatus(userId: string): Promise<{
  exists: boolean;
  verified: boolean;
  resendCount: number;
  resendLimit: number;
  expiresAt: string | null;
  resendAttemptsLeft: number;
  verifyAttempts: number;
  isExpired: boolean;
  resendCooldownSeconds: number;
}> {
  const row = await otpModel.findOtpByUserId(userId);

  if (!row) {
    return {
      exists: false,
      verified: false,
      resendCount: 0,
      resendLimit: env.OTP_MAX_RESENDS,
      expiresAt: null,
      resendAttemptsLeft: env.OTP_MAX_RESENDS,
      verifyAttempts: 0,
      isExpired: false,
      resendCooldownSeconds: 0,
    };
  }

  const isExpired = new Date() > new Date(row.expires_at);
  const cooldownLeft = resendCooldownRemaining(row.last_resent_at, row.created_at);
  const resendAttemptsLeft = Math.max(0, env.OTP_MAX_RESENDS - row.resend_count);

  return {
    exists: true,
    verified: !!row.verified_at,
    resendCount: row.resend_count,
    resendLimit: env.OTP_MAX_RESENDS,
    expiresAt: row.expires_at,
    resendAttemptsLeft,
    verifyAttempts: row.verify_attempts ?? 0,
    isExpired,
    resendCooldownSeconds: cooldownLeft,
  };
}
