
import { supabasePublic, supabaseAdmin } from '../../config/supabase';
import { env } from '../../config/env';
import type { ProfileRow } from '../types/auth.types';

export interface CreateAuthUserInput {
  email: string;
  password: string;
  username: string;
  bio?: string | null;
  department?: string | null;
  course?: string | null;
  year_level?: string | null;
  interests?: string[];
  organizations?: string[];
  avatar_url?: string | null;
  zodiac_sign?: string | null;
  personality_type?: string | null;
  music_taste?: string[];
  movie_interests?: string[];
  age_range?: string | null;
  match_gender_preference?: string | null;
}

export interface SupabaseAuthUser {
  id: string;
  email?: string;
  user_metadata?: Record<string, unknown>;
  app_metadata?: Record<string, unknown>;
  aud?: string;
  created_at?: string;
}

export interface SupabaseSession {
  access_token: string;
  refresh_token?: string;
  expires_at?: number;
}

export interface EmailVerification {
  email: string; 
  isEmailVerified: boolean;
  emailConfirmedAt: string | undefined;
}

/**
 * Creates a new auth user via Supabase Auth.
 *
 * Uses supabasePublic for signUp (this is a public, unauthenticated action).
 * email_confirm is set to TRUE so Supabase does NOT send its own magic-link
 * confirmation email — we handle email confirmation ourselves via OTP.
 *
 * IMPORTANT: schema.sql has an `on_auth_user_created` trigger
 * (handle_new_user) that automatically inserts the matching row into
 * public.profiles by reading these exact keys off raw_user_meta_data.
 */
export async function createAuthUser(
  input: CreateAuthUserInput
): Promise<SupabaseAuthUser> {
  const {
    email,
    password,
    username,
    bio,
    department,
    course,
    year_level,
    interests,
    organizations,
    avatar_url,
    zodiac_sign,
    personality_type,
    music_taste,
    movie_interests,
    age_range,
    match_gender_preference,
  } = input;

  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: false,
    user_metadata: {
      username: username?.toLowerCase(),
      full_name: username?.toLowerCase(),
      avatar_url: avatar_url ?? null,
      bio: bio ?? null,
      department: department ?? null,
      course: course ?? null,
      year_level: year_level ?? null,
      interests: interests ?? [],
      organizations: organizations ?? [],
      zodiac_sign: zodiac_sign ?? null,
      personality_type: personality_type ?? null,
      music_taste: music_taste ?? [],
      movie_interests: movie_interests ?? [],
      age_range: age_range ?? null,
      match_gender_preference: match_gender_preference ?? null,
    },
  });

  if (error) throw error;

  if (!data.user) {
    throw new Error('Failed to create auth user.');
  }

  return data.user as SupabaseAuthUser;
}



/**
 * Signs in with Supabase Auth using email/password.
 * Uses the anon client because this is the standard password-grant flow.
 */
export async function signInWithPassword(input: {
  email: string;
  password: string;
}): Promise<{ user: SupabaseAuthUser; session: SupabaseSession }> {
  const { data, error } = await supabasePublic.auth.signInWithPassword(input);
  if (error) throw error;
  return data as unknown as { user: SupabaseAuthUser; session: SupabaseSession };
}

export async function getUserEmailStatus(id: string): Promise<EmailVerification> {
  const { data, error } = await supabaseAdmin.auth.admin.getUserById(id);
  if (error) throw error;
  return {
    email: data.user.email!,
    isEmailVerified: !!data.user.email_confirmed_at,
    emailConfirmedAt: data.user.email_confirmed_at,
  };
}

/**
 * Signs out a session given its access token.
 * Server-side sign-out with Supabase has no true "kill this token now"
 * primitive unless you maintain a deny-list table — practically, the
 * access token just expires on its own. This is a no-op placeholder kept
 * here so the layering stays consistent if you add a deny-list later.
 */
export async function signOut(_accessToken: string): Promise<void> {
  return;
}

/**
 * Validates an access token and returns the associated auth user.
 */
export async function getUserFromToken(accessToken: string): Promise<SupabaseAuthUser> {
  const { data, error } = await supabasePublic.auth.getUser(accessToken);
  if (error) throw error;
  return data.user as SupabaseAuthUser;
}

/**
 * Checks if a username is already taken (case-insensitive).
 * Note: schema.sql declares `username text unique`, which is a
 * case-SENSITIVE constraint at the DB level. This app-level ilike check
 * is what actually enforces case-insensitive uniqueness — keep it.
 * excludeId lets PATCH /profiles/me check uniqueness against everyone else.
 */
export async function findProfileByUsername(
  username: string,
  excludeId: string | null = null
): Promise<{ id: string } | null> {
  let query = supabaseAdmin.from('profiles').select('id').ilike('username', username).limit(1);

  if (excludeId) {
    query = query.neq('id', excludeId);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data?.[0] as { id: string } | undefined) ?? null;
}

/**
 * Fetches the profile row for a given user id — used to build the
 * AuthSession response after login/register/session-check.
 */
export async function findProfileById(id: string): Promise<ProfileRow | null> {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select(
      'id, email, full_name, username, avatar_url, bio, department, course, year_level, interests, organizations, created_at, email_type, chmsu_auto_verified, pending_student_verification, student_verification_status, admin_verified'
    )
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;
  return data as ProfileRow | null;
}

export async function deleteAuthUser(id: string): Promise<void> {
  // 1. Clean up child records in public schema to prevent FK cascade blockages
  try {
    await supabaseAdmin.from('email_otps').delete().eq('user_id', id);
    await supabaseAdmin.from('notifications').delete().or(`user_id.eq.${id},from_user_id.eq.${id}`);
    await supabaseAdmin.from('comment_likes').delete().eq('user_id', id);
    await supabaseAdmin.from('post_likes').delete().eq('user_id', id);
    await supabaseAdmin.from('post_comments').delete().eq('author_id', id);
    await supabaseAdmin.from('posts').delete().eq('author_id', id);
    await supabaseAdmin.from('follows').delete().or(`follower_id.eq.${id},followed_id.eq.${id}`);
    await supabaseAdmin.from('blocks').delete().or(`blocker_id.eq.${id},blocked_id.eq.${id}`);
    await supabaseAdmin.from('deleted_messages_user').delete().eq('user_id', id);
    await supabaseAdmin.from('message_reactions').delete().eq('user_id', id);
    await supabaseAdmin.from('user_interactions').delete().or(`user_id.eq.${id},target_user_id.eq.${id}`);
    await supabaseAdmin.from('conversation_members').delete().eq('user_id', id);
    await supabaseAdmin.from('messages').delete().eq('sender_id', id);
    await supabaseAdmin.from('profiles').delete().eq('id', id);
  } catch (cleanErr) {
    console.warn('Pre-delete cleanup warning:', cleanErr);
  }

  // 2. Delete the user from Supabase Auth (auth.users)
  const { error } = await supabaseAdmin.auth.admin.deleteUser(id);
  if (error) throw error;
}

/**
 * Sends a password-reset email via Supabase Auth. The emailed link
 * embeds a short-lived recovery token and redirects to redirectTo (the
 * frontend's reset-password page) once clicked.
 *
 * Uses supabasePublic deliberately: resetPasswordForEmail is a public,
 * unauthenticated action — same client login/register use.
 */
export async function sendPasswordResetEmail(email: string, redirectTo: string): Promise<void> {
  const { error } = await supabasePublic.auth.resetPasswordForEmail(email, { redirectTo });
  if (error) throw error;
}

/**
 * Resends the confirmation email to a user who hasn't confirmed yet.
 * @deprecated — OTP flow replaces this. Kept for potential admin reset use.
 */
export async function sendConfirmationEmail(email: string): Promise<void> {
  const { error } = await supabasePublic.auth.resend({
    type: 'signup',
    email,
  });
  if (error) throw error;
}

/**
 * Manually confirms a user's email in Supabase Auth after OTP verification.
 * Called by otp.service.verifyOtp after the code is validated.
 */
export async function confirmEmailManually(userId: string): Promise<void> {
  const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, {
    email_confirm: true,
  });
  if (error) throw error;
}

/**
 * Updates a user's password using the recovery access token.
 *
 * With Supabase's DEFAULT "Reset Password" email template, the emailed
 * link points at Supabase's own /auth/v1/verify endpoint, which verifies
 * the token server-side and then redirects the browser to our
 * redirectTo URL with the result in the hash fragment:
 *   <redirectTo>#access_token=...&refresh_token=...&type=recovery
 * So by the time this function is called, accessToken is already a real,
 * valid session access token — not a token_hash needing verifyOtp. We use
 * it to look up the user, then update the password via the admin API.
 *
 * NOTE: if you later customize the email template to use
 * {{ .TokenHash }} directly (skipping Supabase's own redirect), switch
 * this to supabasePublic.auth.verifyOtp({ token_hash: accessToken, type: 'recovery' })
 * instead, since the token shape changes.
 */
export async function resetPasswordWithToken(accessToken: string, newPassword: string): Promise<void> {
  const { data, error: userError } = await supabasePublic.auth.getUser(accessToken);
  if (userError) throw userError;

  const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(data.user.id, {
    password: newPassword,
  });
  if (updateError) throw updateError;
}

/**
 * Confirms a signup email using the token_hash embedded in the
 * confirmation link sent by Supabase. Returns the resulting session
 * so callers can build an AuthSession from it.
 */
export async function confirmEmailWithTokenHash(
  tokenHash: string
): Promise<{ user: SupabaseAuthUser; session: SupabaseSession }> {
  const { data, error } = await supabasePublic.auth.verifyOtp({
    token_hash: tokenHash,
    type: 'signup',
  });
  if (error) throw error;
  if (!data.user || !data.session) {
    throw new Error('Email confirmation failed: no session returned.');
  }
  return {
    user: data.user as SupabaseAuthUser,
    session: data.session as unknown as SupabaseSession,
  };
}
/**
 * Moderation AND identity-verification flags — checked on every authenticated
 * request (see auth.middleware.ts). Narrow select intentional: fast per-request
 * check, not a full profile load.
 *
 * Approval fields added so the backend can reject unapproved external-email
 * students at the API layer, independent of any frontend routing guard.
 */
export async function getModerationFlags(userId: string): Promise<{
  is_banned: boolean;
  is_suspended: boolean;
  suspended_until: string | null;
  session_invalidated_at: string | null;
  // Identity-verification gate
  email_type: string | null;
  pending_student_verification: boolean;
  student_verification_status: string | null;
  admin_verified: boolean;
  chmsu_auto_verified: boolean;
} | null> {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select(
      'is_banned, is_suspended, suspended_until, session_invalidated_at, ' +
      'email_type, pending_student_verification, student_verification_status, admin_verified, chmsu_auto_verified'
    )
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  return data as any;
}
