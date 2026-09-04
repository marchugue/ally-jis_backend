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
}): Promise<OtpRow> {
  const { userId, email, otpHash, expiresAt, resendCount = 0, lastResentAt = null } = input;

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
