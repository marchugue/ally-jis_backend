// src/app/models/otp.model.ts
//
// MODEL LAYER — database operations for the email_otps table.
// All access via supabaseAdmin (service role) — no RLS on this table.

import { supabaseAdmin } from '../../config/supabase';

export interface OtpRow {
  id: string;
  user_id: string;
  email: string;
  otp_hash: string;
  expires_at: string;
  resend_count: number;
  last_resent_at: string | null;
  verified_at: string | null;
  created_at: string;
  updated_at: string;
  /** Running count of consecutive failed verify attempts — reset on success or new OTP generation */
  verify_attempts: number;
}

/**
 * Upsert an OTP row for the user.
 * We use a single row per user (unique on user_id), replacing it on each
 * new OTP generation. resend_count is carried forward only when resending.
 */
export async function upsertOtp(input: {
  userId: string;
  email: string;
  otpHash: string;
  expiresAt: Date;
  resendCount?: number;
  lastResentAt?: Date | null;
  /** Reset verify_attempts to 0 on each new OTP generation */
  verifyAttempts?: number;
}): Promise<OtpRow> {
  const { userId, email, otpHash, expiresAt, resendCount = 0, lastResentAt = null, verifyAttempts = 0 } = input;

  const { data, error } = await supabaseAdmin
    .from('email_otps')
    .upsert(
      {
        user_id: userId,
        email,
        otp_hash: otpHash,
        expires_at: expiresAt.toISOString(),
        resend_count: resendCount,
        last_resent_at: lastResentAt ? lastResentAt.toISOString() : null,
        verified_at: null,
        verify_attempts: verifyAttempts,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    )
    .select()
    .single();

  if (error) throw error;
  return data as OtpRow;
}

/**
 * Fetch the current OTP row for a user.
 */
export async function findOtpByUserId(userId: string): Promise<OtpRow | null> {
  const { data, error } = await supabaseAdmin
    .from('email_otps')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw error;
  return data as OtpRow | null;
}

/**
 * Mark the OTP as verified (sets verified_at = now).
 */
export async function markOtpVerified(userId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('email_otps')
    .update({ verified_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('user_id', userId);

  if (error) throw error;
}

/**
 * Increment resend_count and update last_resent_at.
 */
export async function incrementResendCount(userId: string): Promise<void> {
  const { error } = await supabaseAdmin.rpc('increment_otp_resend', { p_user_id: userId });

  // Fallback if RPC doesn't exist — plain update with current row's count + 1
  if (error) {
    const row = await findOtpByUserId(userId);
    if (!row) throw new Error('OTP row not found');
    const { error: e2 } = await supabaseAdmin
      .from('email_otps')
      .update({
        resend_count: row.resend_count + 1,
        last_resent_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId);
    if (e2) throw e2;
  }
}

/**
 * Update resend metadata directly (used by otp.service resend logic).
 */
export async function updateResendMeta(userId: string, resendCount: number): Promise<void> {
  const { error } = await supabaseAdmin
    .from('email_otps')
    .update({
      resend_count: resendCount,
      last_resent_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId);

  if (error) throw error;
}

/**
 * Find the latest OTP record for a given email address.
 */
export async function findOtpByEmail(email: string): Promise<OtpRow | null> {
  const { data, error } = await supabaseAdmin
    .from('email_otps')
    .select('*')
    .eq('email', email.toLowerCase().trim())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data as OtpRow | null;
}

/**
 * Find all unverified OTP records that have expired before a given date.
 */
export async function findExpiredUnverifiedOtps(thresholdDate: Date): Promise<OtpRow[]> {
  const { data, error } = await supabaseAdmin
    .from('email_otps')
    .select('*')
    .is('verified_at', null)
    .lt('expires_at', thresholdDate.toISOString())
    .limit(100);

  if (error) throw error;
  return (data || []) as OtpRow[];
}

/**
 * Delete all OTP records for a user.
 */
export async function deleteOtpsForUser(userId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('email_otps')
    .delete()
    .eq('user_id', userId);

  if (error) throw error;
}

/**
 * Atomically increment the verify_attempts counter for a user.
 * Used to track brute-force OTP submission attempts.
 */
export async function incrementVerifyAttempts(userId: string): Promise<number> {
  // Prefer atomic RPC; fallback to read-modify-write
  const { error } = await supabaseAdmin.rpc('increment_otp_verify_attempts', { p_user_id: userId });

  if (!error) {
    const row = await findOtpByUserId(userId);
    return row?.verify_attempts ?? 1;
  }

  // Fallback
  const row = await findOtpByUserId(userId);
  if (!row) throw new Error('OTP row not found');
  const newAttempts = (row.verify_attempts ?? 0) + 1;
  const { error: e2 } = await supabaseAdmin
    .from('email_otps')
    .update({ verify_attempts: newAttempts, updated_at: new Date().toISOString() })
    .eq('user_id', userId);
  if (e2) throw e2;
  return newAttempts;
}

/**
 * Reset verify_attempts to 0 on successful verification or new OTP generation.
 */
export async function resetVerifyAttempts(userId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('email_otps')
    .update({ verify_attempts: 0, updated_at: new Date().toISOString() })
    .eq('user_id', userId);
  if (error) throw error;
}
