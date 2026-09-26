// src/app/models/passwordReset.model.ts
//
// MODEL LAYER — database operations for password_reset_tokens table.

import { supabaseAdmin } from '../../config/supabase';

export type PasswordResetSource = 'web' | 'mobile';

export interface PasswordResetRow {
  id: string;
  user_id: string;
  email: string;
  token_hash: string;
  tracking_token: string;
  source: PasswordResetSource;
  expires_at: string;
  used_at: string | null;
  reset_completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export async function findProfileIdByEmail(email: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('id')
    .ilike('email', email.trim().toLowerCase())
    .maybeSingle();

  if (error) throw error;
  return (data as { id: string } | null)?.id ?? null;
}

export async function findPasswordResetByEmail(email: string): Promise<PasswordResetRow | null> {
  const { data, error } = await supabaseAdmin
    .from('password_reset_tokens')
    .select('*')
    .ilike('email', email.trim().toLowerCase())
    .maybeSingle();

  if (error) throw error;
  return data as PasswordResetRow | null;
}

export async function upsertPasswordResetToken(input: {
  userId: string;
  email: string;
  tokenHash: string;
  trackingToken: string;
  source: PasswordResetSource;
  expiresAt: Date;
}): Promise<PasswordResetRow> {
  const { userId, email, tokenHash, trackingToken, source, expiresAt } = input;

  const { data, error } = await supabaseAdmin
    .from('password_reset_tokens')
    .upsert(
      {
        user_id: userId,
        email: email.trim().toLowerCase(),
        token_hash: tokenHash,
        tracking_token: trackingToken,
        source,
        expires_at: expiresAt.toISOString(),
        used_at: null,
        reset_completed_at: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    )
    .select()
    .single();

  if (error) throw error;
  return data as PasswordResetRow;
}

export async function findPasswordResetByTokenHash(tokenHash: string): Promise<PasswordResetRow | null> {
  const { data, error } = await supabaseAdmin
    .from('password_reset_tokens')
    .select('*')
    .eq('token_hash', tokenHash)
    .maybeSingle();

  if (error) throw error;
  return data as PasswordResetRow | null;
}

export async function findPasswordResetByTrackingToken(trackingToken: string): Promise<PasswordResetRow | null> {
  const { data, error } = await supabaseAdmin
    .from('password_reset_tokens')
    .select('*')
    .eq('tracking_token', trackingToken)
    .maybeSingle();

  if (error) throw error;
  return data as PasswordResetRow | null;
}

export async function markPasswordResetCompleted(userId: string): Promise<PasswordResetRow | null> {
  const now = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from('password_reset_tokens')
    .update({
      used_at: now,
      reset_completed_at: now,
      updated_at: now,
    })
    .eq('user_id', userId)
    .select()
    .maybeSingle();

  if (error) throw error;
  return data as PasswordResetRow | null;
}

export async function deletePasswordResetByUserId(userId: string): Promise<void> {
  const { error } = await supabaseAdmin.from('password_reset_tokens').delete().eq('user_id', userId);
  if (error) throw error;
}
