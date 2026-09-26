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
import * as passwordResetService from './passwordReset.service';
import type { PasswordResetSource } from '../models/passwordReset.model';
import { validatePassword } from '../utils/password.validator';
import { env } from '../../config/env';

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
      user_metadata: {
        ...user.user_metadata,
        ...(profile
          ? {
              full_name: profile.full_name ?? user.user_metadata?.full_name,
              username: profile.username ?? user.user_metadata?.username,
              avatar_url: profile.avatar_url ?? user.user_metadata?.avatar_url,
              bio: profile.bio ?? user.user_metadata?.bio,
              department: profile.department ?? user.user_metadata?.department,
              course: profile.course ?? user.user_metadata?.course,
              year_level: profile.year_level ?? user.user_metadata?.year_level,
              interests: profile.interests ?? user.user_metadata?.interests ?? [],
              organizations: profile.organizations ?? user.user_metadata?.organizations ?? [],
              // Verification gate fields — read by ProtectedRoute / _layout.tsx
              email_type: profile.email_type ?? user.user_metadata?.email_type ?? null,
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
              // Onboarding guard — true if flagged or if academic metadata exists
              onboarding_complete: Boolean(
                user.user_metadata?.onboarding_complete === true ||
                user.user_metadata?.onboarding_complete === 'true' ||
                (profile.course && profile.department && profile.year_level) ||
                (user.user_metadata?.course && user.user_metadata?.department && user.user_metadata?.year_level) ||
                (profile.course && profile.department && profile.year_level && profile.username && Array.isArray(profile.interests) && profile.interests.length >= 3)
              ),
            }
          : {
              onboarding_complete: Boolean(
                user.user_metadata?.onboarding_complete === true ||
                user.user_metadata?.onboarding_complete === 'true' ||
                (user.user_metadata?.course && user.user_metadata?.department && user.user_metadata?.year_level)
              ),
            }),
      },
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
    email_type, student_id_url, student_id_back_url,
  } = payload;

  const registrationsOpen = await adminSettingsService.areRegistrationsEnabled();
  if (!registrationsOpen) {
    throw new HttpError('New registrations are temporarily closed.', 503);
  }

  // ────────────────────────────────────────────────────────────────────────
  // 1. RESUME PENDING VERIFICATION
  //    If the same email already has an active (non-expired, unverified) OTP
  //    row we should NOT create a new account. Instead, resume the existing
  //    session and return the user to the OTP screen.
  //    This prevents duplicate pending registrations and ensures OTP progress
  //    survives accidental page refreshes, app switches, or back navigation.
  // ────────────────────────────────────────────────────────────────────────
  const existingOtpForEmail = await otpModel.findOtpByEmail(email);
  if (existingOtpForEmail && !existingOtpForEmail.verified_at) {
    const otpExpired = new Date() > new Date(existingOtpForEmail.expires_at);
    if (!otpExpired) {
      // Active pending verification — resume it without touching the existing account.
      console.log(`[authService.register] Resuming active pending verification for email "${email}" (userId: ${existingOtpForEmail.user_id})`);
      const otpStatus = await otpService.getOtpStatus(existingOtpForEmail.user_id);
      return {
        userId: existingOtpForEmail.user_id,
        email,
        accessToken: '',
        resumePending: true,
        otpExpiresAt: existingOtpForEmail.expires_at,
        resendCooldownSeconds: otpStatus.resendCooldownSeconds,
      };
    }
    // Expired — purge the stale pending account and allow fresh registration
    console.log(`[authService.register] Purging expired unverified registration for email "${email}" (userId: ${existingOtpForEmail.user_id})`);
    await authModel.deleteAuthUser(existingOtpForEmail.user_id);
  }

  // 2. Pre-check username uniqueness — evict abandoned unverified registrations
  const existing = await authModel.findProfileByUsername(username);
  if (existing) {
    const otpStatus = await otpService.getOtpStatus(existing.id);
    if (otpStatus.exists && !otpStatus.verified && otpStatus.isExpired) {
      // Expired pending registration blocking the username — safe to purge
      console.log(`[authService.register] Purging expired unverified registration for username "${username}" (userId: ${existing.id})`);
      await authModel.deleteAuthUser(existing.id);
    } else if (otpStatus.exists && !otpStatus.verified && !otpStatus.isExpired) {
      // Another user has a LIVE pending registration for this username.
      // The username is temporarily reserved — inform the registrant.
      throw new HttpError(
        'This username is currently reserved by another pending registration. Please choose a different username or try again in a few minutes.',
        409
      );
    } else {
      throw new HttpError('Username is already taken. Please choose a different one.', 409);
    }
  }

  // 3. Determine email type from domain if not provided
  const resolvedEmailType = email_type ?? (email.toLowerCase().endsWith('@chmsu.edu.ph') ? 'chmsu' : 'external');
  const isChmsuEmail = resolvedEmailType === 'chmsu';

  // 4. Create auth user (Supabase immediately marks email_confirmed=false via admin API in the model)
  let authUser: SupabaseAuthUser;
  try {
    authUser = await authModel.createAuthUser({
      email, password, username, bio, department, course, year_level,
      interests, organizations, avatar_url, zodiac_sign, personality_type,
      music_taste, movie_interests, age_range, match_gender_preference,
    });
  } catch (error: any) {
    if (error?.message?.toLowerCase?.().includes('already registered')) {
      // Check if existing auth user is unverified and can be purged
      try {
        const { data: userList } = await supabaseAdmin.auth.admin.listUsers();
        const existingAuthUser = userList?.users?.find(
          (u) => u.email?.toLowerCase().trim() === email.toLowerCase().trim()
        );
        if (existingAuthUser && !existingAuthUser.email_confirmed_at) {
          console.log(`[authService.register] Purging unverified Supabase user "${email}" (userId: ${existingAuthUser.id})`);
          await authModel.deleteAuthUser(existingAuthUser.id);
          authUser = await authModel.createAuthUser({
            email, password, username, bio, department, course, year_level,
            interests, organizations, avatar_url, zodiac_sign, personality_type,
            music_taste, movie_interests, age_range, match_gender_preference,
          });
        } else {
          throw new HttpError('An account with this email already exists. Please log in or use a different email.', 409);
        }
      } catch (retryErr: any) {
        if (retryErr instanceof HttpError) throw retryErr;
        throw new HttpError('An account with this email already exists. Please log in or use a different email.', 409);
      }
    } else {
      throw error;
    }
  }

  // 5. Set email_type, chmsu_auto_verified, and student_id fields on the profile
  const profileUpdate: Record<string, unknown> = {
    email_type: resolvedEmailType,
    chmsu_auto_verified: isChmsuEmail,
  };
  if (!isChmsuEmail && (student_id_url || student_id_back_url)) {
    if (student_id_url) profileUpdate.student_id_url = student_id_url;
    if (student_id_back_url) profileUpdate.student_id_back_url = student_id_back_url;
    profileUpdate.pending_student_verification = true;
    profileUpdate.student_verification_status = 'pending';
  }
  await supabaseAdmin.from('profiles').update(profileUpdate).eq('id', authUser.id);

  // 6. Generate and send OTP — user must verify before they can log in
  await otpService.generateAndSendOtp(authUser.id, email);

  // Fetch the OTP row so we can return the expiry timestamp immediately
  const newOtpRow = await otpModel.findOtpByEmail(email);

  // 7. Return userId + email so the frontend can navigate to the OTP screen.
  //    No accessToken yet — the user is not logged in until OTP is verified.
  return {
    userId: authUser.id,
    email: authUser.email ?? email,
    accessToken: '',
    resumePending: false,
    otpExpiresAt: newOtpRow?.expires_at ?? null,
    resendCooldownSeconds: Number(process.env.OTP_RESEND_COOLDOWN_SECONDS ?? 60),
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
    err.otpExpiresAt = otpStatus.expiresAt;
    err.resendCooldownSeconds = otpStatus.resendCooldownSeconds;
    err.resendAttemptsLeft = otpStatus.resendAttemptsLeft;
    throw err;
  }

  const profile = await authModel.findProfileById(data.user.id);
  return buildAuthSession({ user: data.user, session: data.session, profile });
}

export async function logout(accessToken: string): Promise<void> {
  await authModel.signOut(accessToken);
}

export async function refresh(refreshToken: string): Promise<AuthSession> {
  if (!refreshToken) {
    throw new HttpError('Refresh token is required', 400);
  }

  let data: { user: SupabaseAuthUser; session: SupabaseSession };
  try {
    data = await authModel.refreshSession(refreshToken);
  } catch {
    throw new HttpError('Invalid or expired refresh token', 401);
  }

  const profile = await authModel.findProfileById(data.user.id);
  return buildAuthSession({ user: data.user, session: data.session, profile });
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

  const passwordError = validatePassword(newPassword);
  if (passwordError) {
    throw new HttpError(passwordError, 400);
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
export async function forgotPassword(
  email: string,
  source: PasswordResetSource = 'web'
): Promise<{ trackingToken: string }> {
  return passwordResetService.requestPasswordReset(email, source);
}

export async function verifyPasswordResetOtp(email: string, code: string) {
  return passwordResetService.verifyPasswordResetOtp(email, code);
}

/**
 * POST /auth/reset-password — supports { email, code, newPassword } or { token, newPassword }.
 */
export async function resetPassword(
  paramsOrToken: string | passwordResetService.CompletePasswordResetParams,
  maybePassword?: string
) {
  return passwordResetService.completePasswordReset(paramsOrToken, maybePassword);
}

export async function getPasswordResetStatus(trackingToken: string) {
  return passwordResetService.getPasswordResetStatus(trackingToken);
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
 * Supports identifier as userId string or object with userId and/or email.
 *
 * Safety guard: only allows deletion if the user's OTP has NOT been verified yet
 * and the Supabase auth email is not confirmed.
 * This prevents the endpoint from being used to delete real, active accounts.
 */
export async function cancelRegistration(
  identifier: string | { userId?: string; email?: string }
): Promise<void> {
  let targetUserId = typeof identifier === 'string' ? identifier : identifier.userId;
  const targetEmail = typeof identifier === 'object' ? identifier.email : undefined;

  if (!targetUserId && targetEmail) {
    const otpRow = await otpModel.findOtpByEmail(targetEmail);
    if (otpRow) {
      targetUserId = otpRow.user_id;
    } else {
      const { data: userList } = await supabaseAdmin.auth.admin.listUsers();
      const match = userList?.users?.find(
        (u) => u.email?.toLowerCase().trim() === targetEmail.toLowerCase().trim()
      );
      if (match) targetUserId = match.id;
    }
  }

  if (!targetUserId) {
    // Nothing to cancel or already cleaned
    return;
  }

  // Check OTP status — only allow cancel if NOT verified
  const otpStatus = await otpService.getOtpStatus(targetUserId);

  if (otpStatus.exists && otpStatus.verified) {
    throw new HttpError('Account is already verified and cannot be cancelled via this endpoint.', 403);
  }

  // Also verify user is not confirmed in Supabase Auth
  try {
    const { data: userRes } = await supabaseAdmin.auth.admin.getUserById(targetUserId);
    if (userRes?.user?.email_confirmed_at) {
      throw new HttpError('Account is already verified and cannot be cancelled via this endpoint.', 403);
    }
  } catch (authErr: any) {
    if (authErr instanceof HttpError) throw authErr;
  }

  // Safe to delete — account is pending/unverified
  try {
    await authModel.deleteAuthUser(targetUserId);
    console.log(`[cancelRegistration] Successfully rolled back unverified registration for userId: ${targetUserId}`);
  } catch (err: any) {
    throw new HttpError(err?.message || 'Failed to cancel registration', 500);
  }
}

/**
 * Sweeps the database for unverified registrations where the OTP has expired
 * (older than OTP_EXPIRY_MINUTES) and deletes the unverified auth users and profiles.
 * This ensures abandoned registrations never permanently occupy space or block emails.
 */
export async function cleanupUnverifiedRegistrations(): Promise<number> {
  try {
    const thresholdDate = new Date(Date.now() - env.OTP_EXPIRY_MINUTES * 60 * 1000);
    const expiredOtps = await otpModel.findExpiredUnverifiedOtps(thresholdDate);

    let deletedCount = 0;
    for (const row of expiredOtps) {
      try {
        const { data: userRes } = await supabaseAdmin.auth.admin.getUserById(row.user_id);
        if (!userRes?.user?.email_confirmed_at) {
          await authModel.deleteAuthUser(row.user_id);
          deletedCount++;
        }
      } catch (userErr) {
        console.warn(`[cleanupUnverifiedRegistrations] Error purging user ${row.user_id}:`, userErr);
      }
    }

    if (deletedCount > 0) {
      console.log(`[cleanupUnverifiedRegistrations] Purged ${deletedCount} abandoned unverified registration(s).`);
    }
    return deletedCount;
  } catch (err) {
    console.error('[cleanupUnverifiedRegistrations] Failed to run cleaner:', err);
    return 0;
  }
}

/**
 * Initializes a background cleaner that runs periodically (every 10 minutes)
 * to remove expired, unverified accounts.
 */
export function initUnverifiedRegistrationCleaner(): void {
  // Run on startup after 5 seconds
  setTimeout(() => {
    cleanupUnverifiedRegistrations().catch((err) => console.error('Initial unverified cleaner failed:', err));
  }, 5000);

  // Run every 10 minutes
  const interval = setInterval(() => {
    cleanupUnverifiedRegistrations().catch((err) => console.error('Scheduled unverified cleaner failed:', err));
  }, 10 * 60 * 1000);

  // Ensure timer does not prevent process exit
  if (interval.unref) interval.unref();
}


/**
 * Uploads a student ID photo to Cloudflare R2 (with Supabase Storage fallback)
 * and updates both the Postgres profile row and Supabase Auth user_metadata
 * to put the student account into the pending verification queue.
 */
export async function saveStudentIdUpload(
  userId: string,
  file: { buffer: Buffer; originalname: string; mimetype: string },
  side: 'front' | 'back' = 'front'
): Promise<{ url: string; side: 'front' | 'back' }> {
  const sidePrefix = side === 'back' ? 'back-' : 'front-';
  const key = `student-ids/${userId}/${Date.now()}-${sidePrefix}${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`;

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
  const isBack = side === 'back';
  const profileUpdate: Record<string, unknown> = {
    student_verification_status: 'pending',
    pending_student_verification: true,
    updated_at: new Date().toISOString(),
  };
  if (isBack) {
    profileUpdate.student_id_back_url = publicUrl;
  } else {
    profileUpdate.student_id_url = publicUrl;
  }

  const { error: profileError } = await supabaseAdmin
    .from('profiles')
    .update(profileUpdate)
    .eq('id', userId);

  if (profileError) {
    console.error('Error updating profile with student ID:', profileError);
  }

  // Update Supabase Auth user_metadata so authorization guards recognize pending status
  try {
    const { data: userRes } = await supabaseAdmin.auth.admin.getUserById(userId);
    if (userRes?.user) {
      const existingMeta = userRes.user.user_metadata || {};
      const metaUpdate: Record<string, unknown> = {
        ...existingMeta,
        student_verification_status: 'pending',
        pending_student_verification: true,
      };
      if (isBack) {
        metaUpdate.student_id_back_url = publicUrl;
      } else {
        metaUpdate.student_id_url = publicUrl;
      }
      await supabaseAdmin.auth.admin.updateUserById(userId, {
        user_metadata: metaUpdate,
      });
    }
  } catch (authErr) {
    console.error('Failed to sync auth user_metadata for student ID upload:', authErr);
  }

  return { url: publicUrl, side };
}