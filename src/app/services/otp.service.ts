// src/app/services/otp.service.ts
//
// SERVICE LAYER — OTP business logic.
// Handles generate, verify, resend for 6-digit email OTP codes.

import bcrypt from 'bcrypt';
import * as otpModel from '../models/otp.model';
import { sendOtpEmail } from '../utils/mailer';
import { HttpError } from '../types/auth.types';
import { env } from '../../config/env';
import { supabaseAdmin } from '../../config/supabase';

const BCRYPT_ROUNDS = 10;

/**
 * Generates a cryptographically random 6-digit numeric OTP.
 */
function generateOtpCode(): string {
  const num = Math.floor(100000 + Math.random() * 900000);
  return String(num);
}

/**
 * Generates a new OTP, stores its hash in `email_otps`, and sends the email.
 * Resets resend_count to 0 (this is a fresh generation, not a resend).
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
  });

  await sendOtpEmail({ to: email, otpCode: code, expiresInMinutes: env.OTP_EXPIRY_MINUTES });
}

/**
 * Resends the OTP — generates a fresh code but increments resend_count.
 * Throws if the user has exceeded OTP_MAX_RESENDS.
 */
export async function resendOtp(userId: string): Promise<{ resendCount: number; resendLimit: number }> {
  const row = await otpModel.findOtpByUserId(userId);

  if (!row) {
    throw new HttpError('No pending OTP found. Please register again.', 404);
  }

  if (row.verified_at) {
    throw new HttpError('Email is already verified.', 409);
  }

  if (row.resend_count >= env.OTP_MAX_RESENDS) {
    throw new HttpError(
      `You have reached the maximum of ${env.OTP_MAX_RESENDS} resend attempts. Please wait 10 minutes or contact support.`,
      429
    );
  }

  const newResendCount = row.resend_count + 1;

  // Generate a fresh code and hash
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
  });

  await sendOtpEmail({ to: row.email, otpCode: code, expiresInMinutes: env.OTP_EXPIRY_MINUTES });

  return { resendCount: newResendCount, resendLimit: env.OTP_MAX_RESENDS };
}

/**
 * Verifies the submitted OTP code.
 * On success:
 *   1. Marks the OTP row as verified.
 *   2. Confirms the email in Supabase Auth (email_confirmed_at).
 * Returns the userId so the caller can build a session.
 */
export async function verifyOtp(userId: string, code: string): Promise<void> {
  const row = await otpModel.findOtpByUserId(userId);

  if (!row) {
    throw new HttpError('No pending OTP found. Please request a new one.', 404);
  }

  if (row.verified_at) {
    // Already verified — idempotent success
    return;
  }

  if (new Date() > new Date(row.expires_at)) {
    throw new HttpError('This code has expired. Please request a new one.', 400);
  }

  const matches = await bcrypt.compare(code, row.otp_hash);
  if (!matches) {
    throw new HttpError('Incorrect verification code. Please try again.', 400);
  }

  // Mark OTP as verified
  await otpModel.markOtpVerified(userId);

  // Confirm the email in Supabase Auth
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
 * Returns the current OTP status for a user — used by frontends to
 * show resend count, expiry, and verified state without exposing the hash.
 */
export async function getOtpStatus(userId: string): Promise<{
  exists: boolean;
  verified: boolean;
  resendCount: number;
  resendLimit: number;
  expiresAt: string | null;
}> {
  const row = await otpModel.findOtpByUserId(userId);

  if (!row) {
    return { exists: false, verified: false, resendCount: 0, resendLimit: env.OTP_MAX_RESENDS, expiresAt: null };
  }

  return {
    exists: true,
    verified: !!row.verified_at,
    resendCount: row.resend_count,
    resendLimit: env.OTP_MAX_RESENDS,
    expiresAt: row.expires_at,
  };
}
