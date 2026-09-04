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
import { AuthSession, HttpError, LoginPayload, ProfileRow, RegisterPayload, EmailStatus, RegisterResponse } from '../types/auth.types';
import * as adminSettingsService from './adminSettings.service';
import * as otpService from './otp.service';
import * as otpModel from '../models/otp.model';
import { supabaseAdmin } from '../../config/supabase';
import { uploadToR2Storage } from '../../config/r2';

/**
 * Wraps a Supabase user + session + profile into the AuthSession shape
 * the frontend expects (see client.ts).
 *
 * Verification fields (email_type, pending_student_verification, etc.) are
 * injected into user_metadata so the frontend can gate routing on first
 * login/session restore without a separate profile API call.
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
            // Verification gate fields — read by ProtectedRoute / _layout.tsx
            email_type: profile.email_type ?? null,
            chmsu_auto_verified: profile.chmsu_auto_verified ?? false,
            pending_student_verification: profile.pending_student_verification ?? false,
            student_verification_status: profile.student_verification_status ?? null,
            admin_verified: profile.admin_verified ?? false,
            // Derived convenience flags — frontend uses these directly
            // is_approved: true  → user can access the full app
            // is_approved: false → external student still pending admin review
            is_approved: !!(
              (profile.email_type !== 'external') ||  // CHMSU & other types auto-pass
              profile.chmsu_auto_verified ||
              profile.admin_verified ||
              profile.student_verification_status === 'approved'
            ),
            // Onboarding guard — true only after the user completes step 4 (profile saved with a course)
            onboarding_complete: !!(profile.course && profile.username),
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

export async function register(payload: RegisterPayload): Promise<RegisterResponse> {
  const {
    email, password, username, bio, department, course, year_level, interests,
    organizations, avatar_url, zodiac_sign, personality_type, music_taste,
    movie_interests, age_range, match_gender_preference,
    email_type, student_id_url,
  } = payload;

  const registrationsOpen = await adminSettingsService.areRegistrationsEnabled();
  if (!registrationsOpen) {
    throw new HttpError('New registrations are temporarily closed.', 503);
  }

  // 1. Pre-check username uniqueness
  const existing = await authModel.findProfileByUsername(username);
  if (existing) {
    throw new HttpError('Username already taken', 409);
  }

  // 2. Determine email type from domain if not provided
  const resolvedEmailType = email_type ?? (email.toLowerCase().endsWith('@chmsu.edu.ph') ? 'chmsu' : 'external');
  const isChmsuEmail = resolvedEmailType === 'chmsu';

  // 3. Create auth user (Supabase immediately marks email_confirmed=true via admin API in the model)
  let authUser: SupabaseAuthUser;
  try {
    authUser = await authModel.createAuthUser({
      email, password, username, bio, department, course, year_level,
      interests, organizations, avatar_url, zodiac_sign, personality_type,
      music_taste, movie_interests, age_range, match_gender_preference,
    });
  } catch (error: any) {
    if (error?.message?.toLowerCase?.().includes('already registered')) {
      throw new HttpError('Email already registered', 409);
    }
    throw error;
  }

  // 4. Set email_type, chmsu_auto_verified, and student_id fields on the profile
  const profileUpdate: Record<string, unknown> = {
    email_type: resolvedEmailType,
    chmsu_auto_verified: isChmsuEmail,
  };
  if (!isChmsuEmail && student_id_url) {
    profileUpdate.student_id_url = student_id_url;
    profileUpdate.pending_student_verification = true;
    profileUpdate.student_verification_status = 'pending';
  }
  await supabaseAdmin.from('profiles').update(profileUpdate).eq('id', authUser.id);

  // 5. Generate and send OTP — user must verify before they can log in
  await otpService.generateAndSendOtp(authUser.id, email);

  // 6. Return userId + email so the frontend can navigate to the OTP screen.
  //    No accessToken yet — the user is not logged in until OTP is verified.
  return {
    userId: authUser.id,
    email: authUser.email ?? email,
    accessToken: '',
  };
}

export async function login(payload: LoginPayload): Promise<AuthSession> {
  const { email, password } = payload;

  let data: { user: SupabaseAuthUser; session: SupabaseSession };
  try {
    data = await authModel.signInWithPassword({ email, password });
  } catch (err: any) {
    throw new HttpError('Invalid email or password', 401);
  }

  // Check if the user has verified their OTP. We check our email_otps table
  // rather than Supabase's email_confirmed_at (since we mark confirmed=true
  // immediately on signup to bypass Supabase's own email system).
  const otpStatus = await otpService.getOtpStatus(data.user.id);
  if (otpStatus.exists && !otpStatus.verified) {
    // Surface as 403 so the frontend routes to the OTP verify screen.
    const err = new HttpError('Email not verified. Please enter your verification code.', 403) as any;
    err.requiresOtp = true;
    err.userId = data.user.id;
    err.email = data.user.email;
    throw err;
  }

  const profile = await authModel.findProfileById(data.user.id);
  return buildAuthSession({ user: data.user, session: data.session, profile });
}

export async function logout(accessToken: string): Promise<void> {
  await authModel.signOut(accessToken);
}

/**
 * Change password while logged in — re-authenticates with the current
 * password first (the standard "prove you still know it" step before a
 * sensitive account change), then reuses resetPasswordWithToken for the
 * actual update rather than duplicating the Supabase admin call.
 */
export async function changePassword(input: { userId: string; accessToken: string; currentPassword: string; newPassword: string }): Promise<void> {
  const { userId, accessToken, currentPassword, newPassword } = input;

  const profile = await authModel.findProfileById(userId);
  if (!profile?.email) {
    throw new HttpError('Could not resolve account email', 400);
  }

  try {
    await authModel.signInWithPassword({ email: profile.email, password: currentPassword });
  } catch {
    throw new HttpError('Current password is incorrect', 401);
  }

  await authModel.resetPasswordWithToken(accessToken, newPassword);
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

export async function isEmailVerified(id: string): Promise<EmailStatus> {
  try {
    const data = await authModel.getUserEmailStatus(id);
    return {
      email: data.email,
      isEmailVerified: data.isEmailVerified,
      emailConfirmedAt: data.emailConfirmedAt,
    };
  } catch {
    throw new HttpError('User Id Is Not Existed Yet', 401);
  }
}

/**
 * POST /auth/confirm
 * Exchanges the token_hash embedded in the Supabase email-confirmation
 * link for a real session. Returns an AuthSession the frontend can use
 * to log the user in automatically after confirming.
 */
export async function confirmEmail(tokenHash: string): Promise<AuthSession> {
  let result: { user: SupabaseAuthUser; session: SupabaseSession };
  try {
    result = await authModel.confirmEmailWithTokenHash(tokenHash);
  } catch {
    throw new HttpError('Confirmation link is invalid or has expired', 400);
  }

  const profile = await authModel.findProfileById(result.user.id);
  return buildAuthSession({ user: result.user, session: result.session, profile });
}

/**
 * Creates a signed session for a user after OTP verification.
 * Called by the POST /auth/otp/verify controller to give the frontend
 * a real access token once the email has been confirmed.
 *
 * Flow: fetch user by id → generate magic link → exchange hashed_token for session.
 * This is the recommended Supabase pattern for server-side session creation.
 */
export async function buildSessionForUser(userId: string): Promise<AuthSession> {
  const { supabaseAdmin, supabasePublic } = await import('../../config/supabase');

  const { data: userData, error: userError } = await supabaseAdmin.auth.admin.getUserById(userId);
  if (userError || !userData.user) {
    throw new HttpError('User not found', 404);
  }

  const user = userData.user as SupabaseAuthUser;
  const profile = await authModel.findProfileById(userId);

  // Generate a magic link and immediately exchange the hashed_token for real tokens.
  const { data: genData, error: genError } = await supabaseAdmin.auth.admin.generateLink({
    type: 'magiclink',
    email: user.email!,
  });

  if (genError || !genData.properties?.hashed_token) {
    throw new HttpError('Failed to create session after OTP verification', 500);
  }

  const { data: sessionData, error: sessionError } = await supabasePublic.auth.verifyOtp({
    token_hash: genData.properties.hashed_token,
    type: 'magiclink',
  });

  if (sessionError || !sessionData.session) {
    throw new HttpError('Failed to create session after OTP verification', 500);
  }

  return buildAuthSession({
    user: sessionData.user as SupabaseAuthUser,
    session: sessionData.session as unknown as SupabaseSession,
    profile,
  });
}

/**
 * Permanently deletes the authenticated user's account and all associated data.
 */
export async function deleteOwnAccount(userId: string): Promise<void> {
  try {
    await authModel.deleteAuthUser(userId);
  } catch (err: any) {
    throw new HttpError(err?.message || 'Failed to delete account', 500);
  }
}

/**
 * Cancels an in-progress registration by deleting the pending unverified account.
 *
 * Safety guard: only allows deletion if the user's OTP has NOT been verified yet.
 * This prevents the endpoint from being used to delete real, active accounts.
 *
 * Called when the user clicks "← Change email address" on the OTP screen —
 * rolls back the Supabase auth user, the profile row, and the OTP entry so
 * the user can restart with a clean slate (same or different username/email).
 */
export async function cancelRegistration(userId: string): Promise<void> {
  // Check OTP status — only allow cancel if NOT verified
  const otpStatus = await otpService.getOtpStatus(userId);

  if (otpStatus.verified) {
    // The user already verified their email — this is a real account.
    // Refuse to delete it via this unauthenticated endpoint.
    throw new HttpError('Account is already verified and cannot be cancelled via this endpoint.', 403);
  }

  // Safe to delete — account is pending/unverified
  try {
    await authModel.deleteAuthUser(userId);
  } catch (err: any) {
    throw new HttpError(err?.message || 'Failed to cancel registration', 500);
  }
}

/**
 * Uploads a student ID photo to Cloudflare R2 (with Supabase Storage fallback)
 * and updates both the Postgres profile row and Supabase Auth user_metadata
 * to put the student account into the pending verification queue.
 */
export async function saveStudentIdUpload(
  userId: string,
  file: { buffer: Buffer; originalname: string; mimetype: string }
): Promise<string> {
  const key = `student-ids/${userId}/${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`;

  let publicUrl = await uploadToR2Storage({ path: key, buffer: file.buffer, contentType: file.mimetype });

  // Fallback to Supabase Storage if R2 is not configured
  if (!publicUrl) {
    const { error: uploadError } = await supabaseAdmin.storage
      .from('student-ids')
      .upload(key, file.buffer, { contentType: file.mimetype, upsert: true });

    if (uploadError) {
      console.error('Supabase storage upload error:', uploadError);
      throw new HttpError('Failed to upload student ID file', 500);
    }

    const { data: urlData } = supabaseAdmin.storage.from('student-ids').getPublicUrl(key);
    publicUrl = urlData.publicUrl;
  }

  // Update profile record in Postgres
  const { error: profileError } = await supabaseAdmin
    .from('profiles')
    .update({
      student_id_url: publicUrl,
      student_verification_status: 'pending',
      pending_student_verification: true,
      updated_at: new Date().toISOString(),
    })
    .eq('id', userId);

  if (profileError) {
    console.error('Error updating profile with student ID:', profileError);
  }

  // Update Supabase Auth user_metadata so authorization guards recognize pending status
  try {
    const { data: userRes } = await supabaseAdmin.auth.admin.getUserById(userId);
    if (userRes?.user) {
      const existingMeta = userRes.user.user_metadata || {};
      await supabaseAdmin.auth.admin.updateUserById(userId, {
        user_metadata: {
          ...existingMeta,
          student_verification_status: 'pending',
          pending_student_verification: true,
          student_id_url: publicUrl,
        },
      });
    }
  } catch (authErr) {
    console.error('Failed to sync auth user_metadata for student ID upload:', authErr);
  }

  return publicUrl;
}