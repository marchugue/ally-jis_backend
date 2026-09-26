// src/app/services/passwordReset.service.ts
//
// Resend-based password reset (no Supabase Auth email). Stores hashed tokens in
// password_reset_tokens and notifies clients via Socket.io when a reset completes.

import crypto from 'crypto';
import * as passwordResetModel from '../models/passwordReset.model';
import type { PasswordResetSource } from '../models/passwordReset.model';
import * as authModel from '../models/auth.model';
import { sendPasswordResetEmail } from '../utils/mailer';
import { validatePassword } from '../utils/password.validator';
import { HttpError } from '../types/auth.types';
import { env } from '../../config/env';
import { emitToPasswordResetTracking, emitToUser } from './realtime.service';

const TOKEN_BYTES = 32;

function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function generateToken(): string {
  return crypto.randomBytes(TOKEN_BYTES).toString('hex');
}

/** Opaque tracking id returned to clients (mobile) — never used in the email link. */
function generateTrackingToken(): string {
  return crypto.randomBytes(16).toString('hex');
}

/** Dummy tracking token when no account exists (anti-enumeration). */
function dummyTrackingToken(): string {
  return crypto.randomBytes(16).toString('hex');
}

function buildResetLink(rawToken: string): string {
  const base = env.PASSWORD_RESET_REDIRECT_URL.replace(/\/$/, '');
  return `${base}?token=${encodeURIComponent(rawToken)}`;
}

export interface ForgotPasswordResult {
  trackingToken: string;
}

/**
 * POST /auth/forgot-password
 * Always returns a tracking token so mobile can watch completion without leaking
 * whether the email is registered.
 */
export async function requestPasswordReset(
  email: string,
  source: PasswordResetSource = 'web'
): Promise<ForgotPasswordResult> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) {
    return { trackingToken: dummyTrackingToken() };
  }

  const userId = await passwordResetModel.findProfileIdByEmail(normalized);
  if (!userId) {
    return { trackingToken: dummyTrackingToken() };
  }

  const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
  const rawToken = otpCode;
  const tokenHash = hashToken(normalized + ':' + otpCode);
  const trackingToken = generateTrackingToken();
  const expiresAt = new Date(Date.now() + env.PASSWORD_RESET_EXPIRY_MINUTES * 60 * 1000);

  try {
    await passwordResetModel.upsertPasswordResetToken({
      userId,
      email: normalized,
      tokenHash,
      trackingToken,
      source,
      expiresAt,
    });
  } catch (err) {
    console.error('[passwordReset] Failed to store reset token (run migration 016?):', err);
    throw new HttpError(
      'Password reset is temporarily unavailable. Please try again later.',
      503,
    );
  }

  const resetLink = `${buildResetLink(rawToken)}&email=${encodeURIComponent(normalized)}`;

  try {
    await sendPasswordResetEmail({
      to: normalized,
      resetLink,
      expiresInMinutes: env.PASSWORD_RESET_EXPIRY_MINUTES,
      otpCode,
    });
  } catch (err) {
    console.error('[passwordReset] Failed to send email:', err);
  }

  return { trackingToken };
}

export interface CompletePasswordResetResult {
  source: PasswordResetSource;
  trackingToken: string;
}

export interface CompletePasswordResetParams {
  rawToken?: string;
  email?: string;
  code?: string;
  newPassword: string;
}

/**
 * POST /auth/password-reset/verify-otp — verifies 6-digit code for an email before setting new password.
 */
export async function verifyPasswordResetOtp(
  email: string,
  code: string
): Promise<{ valid: boolean; trackingToken: string }> {
  const normalized = email.trim().toLowerCase();
  const cleaned = code.trim();
  if (!normalized || !cleaned) {
    throw new HttpError('Email and 6-digit code are required.', 400);
  }

  const row = await passwordResetModel.findPasswordResetByEmail(normalized);
  if (!row) {
    throw new HttpError('No pending password reset found for this email. Please request a new code.', 404);
  }

  if (row.used_at || row.reset_completed_at) {
    throw new HttpError('This verification code has already been used.', 400);
  }

  if (new Date(row.expires_at).getTime() < Date.now()) {
    throw new HttpError('This verification code has expired. Please request a new one.', 400);
  }

  const expectedHash = hashToken(normalized + ':' + cleaned);
  const legacyHash = hashToken(cleaned);
  if (row.token_hash !== expectedHash && row.token_hash !== legacyHash) {
    throw new HttpError('Incorrect verification code. Please check and try again.', 400);
  }

  return { valid: true, trackingToken: row.tracking_token };
}

/**
 * POST /auth/reset-password — handles both 6-digit OTP code + email and legacy raw token.
 */
export async function completePasswordReset(
  paramsOrToken: string | CompletePasswordResetParams,
  maybePassword?: string
): Promise<CompletePasswordResetResult> {
  let rawToken: string | undefined;
  let email: string | undefined;
  let code: string | undefined;
  let newPassword: string;

  if (typeof paramsOrToken === 'string') {
    rawToken = paramsOrToken;
    newPassword = maybePassword || '';
  } else {
    rawToken = paramsOrToken.rawToken;
    email = paramsOrToken.email;
    code = paramsOrToken.code;
    newPassword = paramsOrToken.newPassword;
  }

  const passwordError = validatePassword(newPassword);
  if (passwordError) {
    throw new HttpError(passwordError, 400);
  }

  let row: passwordResetModel.PasswordResetRow | null = null;

  if (email && code) {
    const normalized = email.trim().toLowerCase();
    const cleaned = code.trim();
    row = await passwordResetModel.findPasswordResetByEmail(normalized);
    if (!row) {
      throw new HttpError('No pending reset request found for this email.', 404);
    }
    const expectedHash = hashToken(normalized + ':' + cleaned);
    const legacyHash = hashToken(cleaned);
    if (row.token_hash !== expectedHash && row.token_hash !== legacyHash) {
      throw new HttpError('Incorrect verification code. Please try again.', 400);
    }
  } else if (rawToken) {
    const tokenHash = hashToken(rawToken.trim());
    row = await passwordResetModel.findPasswordResetByTokenHash(tokenHash);
    if (!row && email) {
      const normalized = email.trim().toLowerCase();
      const candidate = await passwordResetModel.findPasswordResetByEmail(normalized);
      if (
        candidate &&
        (candidate.token_hash === hashToken(normalized + ':' + rawToken.trim()) ||
          candidate.token_hash === hashToken(rawToken.trim()))
      ) {
        row = candidate;
      }
    }
  }

  if (!row) {
    throw new HttpError('Reset link or code is invalid or has expired', 400);
  }

  if (row.used_at || row.reset_completed_at) {
    throw new HttpError('This reset link or code has already been used', 400);
  }

  if (new Date(row.expires_at).getTime() < Date.now()) {
    throw new HttpError('Reset link or code has expired. Please request a new one.', 400);
  }

  await authModel.updateUserPassword(row.user_id, newPassword);

  try {
    const status = await authModel.getUserEmailStatus(row.user_id);
    if (!status.isEmailVerified) {
      await authModel.confirmEmailManually(row.user_id);
    }
  } catch (err) {
    console.warn('[passwordReset] Email confirm after reset skipped:', err);
  }

  await passwordResetModel.markPasswordResetCompleted(row.user_id);

  const payload = {
    trackingToken: row.tracking_token,
    source: row.source,
    completedAt: new Date().toISOString(),
  };

  emitToPasswordResetTracking(row.tracking_token, 'password_reset:completed', payload);
  emitToUser(row.user_id, 'password_reset:completed', payload);

  return { source: row.source, trackingToken: row.tracking_token };
}

export type PasswordResetStatus = 'pending' | 'completed' | 'unknown';

export async function getPasswordResetStatus(trackingToken: string): Promise<{
  status: PasswordResetStatus;
  source?: PasswordResetSource;
  completedAt?: string | null;
}> {
  const token = trackingToken?.trim();
  if (!token) {
    return { status: 'unknown' };
  }

  const row = await passwordResetModel.findPasswordResetByTrackingToken(token);
  if (!row) {
    return { status: 'unknown' };
  }

  if (row.reset_completed_at) {
    return {
      status: 'completed',
      source: row.source,
      completedAt: row.reset_completed_at,
    };
  }

  return { status: 'pending', source: row.source };
}
