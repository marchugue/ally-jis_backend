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

  const rawToken = generateToken();
  const tokenHash = hashToken(rawToken);
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

  const resetLink = buildResetLink(rawToken);

  try {
    await sendPasswordResetEmail({
      to: normalized,
      resetLink,
      expiresInMinutes: env.PASSWORD_RESET_EXPIRY_MINUTES,
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

/**
 * POST /auth/reset-password — token is the raw token from the email link query param.
 */
export async function completePasswordReset(
  rawToken: string,
  newPassword: string
): Promise<CompletePasswordResetResult> {
  const passwordError = validatePassword(newPassword);
  if (passwordError) {
    throw new HttpError(passwordError, 400);
  }

  const tokenHash = hashToken(rawToken.trim());
  const row = await passwordResetModel.findPasswordResetByTokenHash(tokenHash);
  if (!row) {
    throw new HttpError('Reset link is invalid or has expired', 400);
  }

  if (row.used_at || row.reset_completed_at) {
    throw new HttpError('This reset link has already been used', 400);
  }

  if (new Date(row.expires_at).getTime() < Date.now()) {
    throw new HttpError('Reset link is invalid or has expired', 400);
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
