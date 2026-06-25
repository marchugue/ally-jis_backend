
import { supabasePublic, supabaseAdmin } from '../../config/supabase';
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

/**
 * Creates a new auth user via Supabase Auth.
 *
 * Uses supabaseAdmin so we can auto-confirm the email (no email
 * verification step) and so this works server-side without a session.
 *
 * IMPORTANT: schema.sql has an `on_auth_user_created` trigger
 * (handle_new_user) that automatically inserts the matching row into
 * public.profiles by reading these exact keys off raw_user_meta_data:
 *   username, full_name, avatar_url, bio, department, course,
 *   year_level, interests (jsonb array), organizations (jsonb array)
 * So we pass profile fields here as `user_metadata` instead of doing a
 * separate insert into profiles — the trigger does that for us.
 */
export async function createAuthUser(
  input: CreateAuthUserInput
): Promise<SupabaseAuthUser> {
  const { email, password, username, bio, department, course, year_level, interests, organizations, avatar_url } = input;

  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
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
    },
  });

  if (error) throw error;
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
      'id, email, full_name, username, avatar_url, bio, department, course, year_level, interests, organizations, created_at'
    )
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;
  return data as ProfileRow | null;
}

/**
 * Deletes the auth user (cascades to profiles via FK in schema.sql),
 * used by DELETE /profiles/me.
 */
export async function deleteAuthUser(id: string): Promise<void> {
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