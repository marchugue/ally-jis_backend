// src/services/auth.service.ts
//
// SERVICE LAYER
// -------------
// Business rules live here: "is this username taken", "build the
// AuthSession shape", "what happens on register vs login". This layer
// calls the model — it never calls Supabase directly and never touches
// req/res.

import * as authModel from '../models/auth.model';
import type { SupabaseAuthUser, SupabaseSession } from '../models/auth.model';
import { AuthSession, HttpError, LoginPayload, ProfileRow, RegisterPayload } from '../types/auth.types';

/**
 * Wraps a Supabase user + session + profile into the AuthSession shape
 * the frontend expects (see client.ts).
 */
function buildAuthSession(args: {
  user: SupabaseAuthUser;
  session: SupabaseSession;
  profile: ProfileRow | null;
}): AuthSession {
  const { user, session, profile } = args;

  return {
    user: {
      id: user.id,
      email: user.email ?? '',
      user_metadata: profile
        ? {
            full_name: profile.full_name,
            username: profile.username,
            avatar_url: profile.avatar_url,
          }
        : user.user_metadata,
      app_metadata: user.app_metadata,
      aud: user.aud,
      created_at: user.created_at,
    },
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    expiresAt: session.expires_at,
  };
}

export async function register(payload: RegisterPayload): Promise<AuthSession> {
  const { email, password, username, bio, department, course, year_level, interests, organizations, avatar_url } =
    payload;

  // 1. Pre-check username uniqueness before creating the auth user, so we
  //    don't end up with an orphaned auth user if the username is taken.
  const existing = await authModel.findProfileByUsername(username);
  if (existing) {
    throw new HttpError('Username already taken', 409);
  }

  // 2. Create the auth user. schema.sql's `on_auth_user_created` trigger
  //    (handle_new_user) reads user_metadata and inserts the matching
  //    public.profiles row automatically — no separate insert needed here.
  let authUser: SupabaseAuthUser;
  try {
    authUser = await authModel.createAuthUser({
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
    });
  } catch (error: any) {
    if (error?.message?.toLowerCase?.().includes('already registered')) {
      throw new HttpError('Email already registered', 409);
    }
    throw error;
  }

  // 3. Read back the profile row the trigger just created.
  const profile = await authModel.findProfileById(authUser.id);

  // 4. Sign in immediately so register returns a usable session, same as login.
  const { session } = await authModel.signInWithPassword({ email, password });

  return buildAuthSession({ user: authUser, session, profile });
}

export async function login(payload: LoginPayload): Promise<AuthSession> {
  const { email, password } = payload;

  let data: { user: SupabaseAuthUser; session: SupabaseSession };
  try {
    data = await authModel.signInWithPassword({ email, password });
  } catch {
    throw new HttpError('Invalid email or password', 401);
  }

  const profile = await authModel.findProfileById(data.user.id);

  return buildAuthSession({ user: data.user, session: data.session, profile });
}

export async function logout(accessToken: string): Promise<void> {
  await authModel.signOut(accessToken);
}

export async function getSession(accessToken: string): Promise<AuthSession> {
  let user: SupabaseAuthUser;
  try {
    user = await authModel.getUserFromToken(accessToken);
  } catch {
    throw new HttpError('Invalid or expired session', 401);
  }

  const profile = await authModel.findProfileById(user.id);

  return buildAuthSession({
    user,
    session: { access_token: accessToken },
    profile,
  });
}

/**
 * POST /auth/forgot-password
 * Always resolves successfully regardless of whether the email exists —
 * returning a different response for "not found" would let an attacker
 * enumerate registered emails. Supabase silently no-ops if the address
 * isn't registered, so we just await it and swallow that case too.
 */
export async function forgotPassword(email: string, redirectTo: string): Promise<void> {
  try {
    await authModel.sendPasswordResetEmail(email, redirectTo);
  } catch {
    // Intentionally swallowed — see comment above. Real delivery failures
    // (bad SMTP config, etc.) are logged by Supabase on their end; we
    // don't want this endpoint's response to leak which emails exist.
  }
}

/**
 * POST /auth/reset-password
 * accessToken here is the recovery token from the emailed reset link
 * (passed by the frontend as a query/hash param on its reset-password page).
 */
export async function resetPassword(accessToken: string, newPassword: string): Promise<void> {
  try {
    await authModel.resetPasswordWithToken(accessToken, newPassword);
  } catch {
    throw new HttpError('Reset link is invalid or has expired', 400);
  }
}