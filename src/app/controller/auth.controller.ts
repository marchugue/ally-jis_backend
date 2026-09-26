// src/controllers/auth.controller.ts
//
// CONTROLLER LAYER
// -----------------
// Reads req, calls the service, writes the HTTP response. No SQL, no
// Supabase calls, no business rules — just translating HTTP <-> service.

import type { Request, Response } from 'express';
import * as authService from '../services/auth.service';
import * as otpService from '../services/otp.service';
import * as otpModel from '../models/otp.model';
import { asyncHandler } from '../utils/asyncHandler';
import { HttpError, type LoginPayload, type RegisterPayload } from '../types/auth.types';
import { env } from '../../config/env';
import { uploadToR2Storage } from '../../config/r2';
import { 
  setRefreshTokenCookie, 
  clearRefreshTokenCookie, 
  REFRESH_TOKEN_COOKIE_NAME 
} from '../utils/cookie.util';

export const register = asyncHandler(async (req: Request, res: Response) => {
  const payload = req.body as RegisterPayload;
  const result = await authService.register(payload);
  // Returns { userId, email, accessToken: '', resumePending, otpExpiresAt, resendCooldownSeconds }
  // resumePending=true means an active pending verification was found and resumed
  res.status(result.resumePending ? 200 : 201).json(result);
});

export const login = asyncHandler(async (req: Request, res: Response) => {
  const { email, password } = req.body as LoginPayload;
  try {
    const session = await authService.login({ email, password });
    if (session.refreshToken) {
      setRefreshTokenCookie(res, session.refreshToken);
    }
    res.status(200).json(session);
  } catch (err: any) {
    // Forward OTP-required metadata so the client can restore the verification
    // screen with accurate countdown + resend state without a second round-trip.
    if (err.requiresOtp) {
      res.status(403).json({
        message: err.message,
        requiresOtp: true,
        userId: err.userId,
        email: err.email,
        otpExpiresAt: err.otpExpiresAt ?? null,
        resendCooldownSeconds: err.resendCooldownSeconds ?? 0,
        resendAttemptsLeft: err.resendAttemptsLeft ?? null,
      });
      return;
    }
    throw err;
  }
});

export const logout = asyncHandler(async (req: Request, res: Response) => {
  await authService.logout(req.accessToken as string);
  clearRefreshTokenCookie(res);
  res.status(204).send();
});

// POST /auth/refresh — silent token refresh (reads cookie or body fallback)
export const refreshToken = asyncHandler(async (req: Request, res: Response) => {
  const token = req.cookies?.[REFRESH_TOKEN_COOKIE_NAME] || req.body?.refreshToken;

  if (!token) {
    throw new HttpError('No refresh token provided', 401);
  }

  const session = await authService.refresh(token);

  // Extend sliding session expiration (+30 days)
  if (session.refreshToken) {
    setRefreshTokenCookie(res, session.refreshToken);
  }

  res.status(200).json(session);
});

export const session = asyncHandler(async (req: Request, res: Response) => {
  const authSession = await authService.getSession(req.accessToken as string);
  res.status(200).json(authSession);
});

// POST /auth/forgot-password
export const forgotPassword = asyncHandler(async (req: Request, res: Response) => {
  const { email, source } = req.body as { email: string; source?: 'web' | 'mobile' };
  const result = await authService.forgotPassword(email, source === 'mobile' ? 'mobile' : 'web');
  res.status(200).json(result);
});

// POST /auth/password-reset/verify-otp
export const verifyPasswordResetOtp = asyncHandler(async (req: Request, res: Response) => {
  const { email, code } = req.body as { email: string; code: string };
  const result = await authService.verifyPasswordResetOtp(email, code);
  res.status(200).json(result);
});

// POST /auth/reset-password
export const resetPassword = asyncHandler(async (req: Request, res: Response) => {
  const { token, code, email, password } = req.body as {
    token?: string;
    code?: string;
    email?: string;
    password: string;
  };
  const result = await authService.resetPassword({
    rawToken: token,
    code,
    email,
    newPassword: password,
  });
  res.status(200).json({
    source: result.source,
    trackingToken: result.trackingToken,
    mobileRedirectUrl: env.MOBILE_PASSWORD_RESET_SUCCESS_URL,
  });
});

// GET /auth/password-reset/status/:trackingToken
export const getPasswordResetStatus = asyncHandler(async (req: Request, res: Response) => {
  const { trackingToken } = req.params as { trackingToken: string };
  const status = await authService.getPasswordResetStatus(trackingToken);
  res.status(200).json(status);
});

// POST /auth/change-password — logged in, requires current password
export const changePassword = asyncHandler(async (req: Request, res: Response) => {
  const { currentPassword, newPassword } = req.body as { currentPassword: string; newPassword: string };
  await authService.changePassword({
    userId: req.userId as string,
    accessToken: req.accessToken as string,
    currentPassword,
    newPassword,
  });
  res.status(204).send();
});

// GET /auth/email/:id
export const getEmailVerificationStatus = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params as { id: string };
  const data = await authService.isEmailVerified(id);
  res.status(200).json(data);
});

// POST /auth/confirm — legacy, kept for backwards compatibility
// Redirects clients to use /auth/otp/verify instead
export const confirmEmail = asyncHandler(async (req: Request, res: Response) => {
  const { token_hash } = req.body as { token_hash: string };
  if (!token_hash) {
    res.status(400).json({ error: 'token_hash is required' });
    return;
  }
  const session = await authService.confirmEmail(token_hash);
  res.status(200).json(session);
});

// ─── OTP Endpoints ───────────────────────────────────────────────────────────

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(val?: string | null): boolean {
  return typeof val === 'string' && UUID_REGEX.test(val.trim());
}

// POST /auth/otp/send — generate a new OTP and send it to the user's email
export const sendOtp = asyncHandler(async (req: Request, res: Response) => {
  const { userId, email } = req.body as { userId?: string; email: string };
  let targetUserId = userId;
  if ((!targetUserId || !isUuid(targetUserId)) && email) {
    const row = await otpModel.findOtpByEmail(email);
    if (row) targetUserId = row.user_id;
  }
  if (!targetUserId || !email) {
    res.status(400).json({ message: 'userId and email are required' });
    return;
  }
  await otpService.generateAndSendOtp(targetUserId, email);
  res.status(204).send();
});

// POST /auth/otp/verify — verify the submitted OTP and return a session
export const verifyOtp = asyncHandler(async (req: Request, res: Response) => {
  const { userId, code, email } = req.body as { userId?: string; code: string; email?: string };
  if (!code || (!userId && !email)) {
    res.status(400).json({ message: 'userId or email, and code are required' });
    return;
  }
  let targetUserId = userId;
  if ((!targetUserId || !isUuid(targetUserId)) && (email || (targetUserId && targetUserId.includes('@')))) {
    const searchEmail = email || targetUserId!;
    const row = await otpModel.findOtpByEmail(searchEmail);
    if (!row) {
      throw new HttpError('No pending verification found for this email.', 404);
    }
    targetUserId = row.user_id;
  }
  if (!targetUserId) {
    throw new HttpError('No pending verification found.', 404);
  }
  try {
    // Verify the OTP (marks email confirmed in Supabase Auth on success)
    await otpService.verifyOtp(targetUserId, code);
  } catch (err: any) {
    // Forward verifyAttemptsLeft so clients can show a counter without polling
    if (err.verifyAttemptsLeft !== undefined) {
      res.status(err.status ?? 400).json({
        message: err.message,
        verifyAttemptsLeft: err.verifyAttemptsLeft,
      });
      return;
    }
    throw err;
  }

  // Build and return a real session now that the user is verified
  const session = await authService.buildSessionForUser(targetUserId);
  if (session.refreshToken) {
    setRefreshTokenCookie(res, session.refreshToken);
  }
  res.status(200).json(session);
});

// POST /auth/otp/resend — resend with resend count tracking
export const resendOtp = asyncHandler(async (req: Request, res: Response) => {
  const { userId, email } = req.body as { userId?: string; email?: string };
  let targetUserId = userId;
  if ((!targetUserId || !isUuid(targetUserId)) && (email || (targetUserId && targetUserId.includes('@')))) {
    const searchEmail = email || targetUserId!;
    const row = await otpModel.findOtpByEmail(searchEmail);
    if (!row) {
      throw new HttpError('No pending verification found for this email.', 404);
    }
    targetUserId = row.user_id;
  }
  if (!targetUserId) {
    res.status(400).json({ message: 'userId or email is required' });
    return;
  }
  try {
    const result = await otpService.resendOtp(targetUserId);
    res.status(200).json(result);
  } catch (err: any) {
    // Forward cooldown seconds in the error body so clients can re-render the button state
    if (err.resendCooldownSeconds !== undefined) {
      res.status(err.status ?? 429).json({
        message: err.message,
        resendCooldownSeconds: err.resendCooldownSeconds,
      });
      return;
    }
    throw err;
  }
});

// GET /auth/otp/status/:userId — returns OTP state without code
export const getOtpStatus = asyncHandler(async (req: Request, res: Response) => {
  const { userId } = req.params as { userId: string };
  const emailQuery = req.query.email as string | undefined;
  let targetUserId = userId;
  if ((!targetUserId || !isUuid(targetUserId)) && (emailQuery || (targetUserId && targetUserId.includes('@')))) {
    const searchEmail = emailQuery || targetUserId;
    const row = await otpModel.findOtpByEmail(searchEmail);
    if (row) {
      targetUserId = row.user_id;
    } else {
      res.status(200).json({ exists: false, verified: false, resendCount: 0, resendLimit: env.OTP_MAX_RESENDS, expiresAt: null });
      return;
    }
  }
  const status = await otpService.getOtpStatus(targetUserId);
  res.status(200).json(status);
});

// ─── Student ID Upload ────────────────────────────────────────────────────────

// POST /auth/student-id/upload — upload student ID image to R2
// The user must be registered (userId in body) but doesn't need a session yet.
export const uploadStudentId = asyncHandler(async (req: Request, res: Response) => {
  const { userId, side = 'front' } = req.body as { userId: string; side?: 'front' | 'back' };
  const file = req.file;

  if (!userId || !file) {
    res.status(400).json({ message: 'userId and file are required' });
    return;
  }

  const result = await authService.saveStudentIdUpload(
    userId,
    {
      buffer: file.buffer,
      originalname: file.originalname,
      mimetype: file.mimetype,
    },
    side === 'back' ? 'back' : 'front'
  );

  res.status(200).json(result);
});

/**
 * DELETE /api/auth/delete-account
 * Authenticated user permanently deletes their own account.
 */
export const deleteAccount = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.userId;
  if (!userId) {
    throw new HttpError('Unauthorized', 401);
  }

  await authService.deleteOwnAccount(userId);
  res.status(200).json({ message: 'Account permanently deleted' });
});

/**
 * DELETE /api/auth/register/cancel
 * Rolls back a pending (unverified) registration.
 * No auth token required — the user doesn't have a session yet.
 * Protected by a server-side guard: refuses if OTP is already verified.
 */
export const cancelRegistration = asyncHandler(async (req: Request, res: Response) => {
  let body: any = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      // ignore
    }
  }

  const userId = body?.userId || (req.query?.userId as string);
  const email = body?.email || (req.query?.email as string);

  if (!userId && !email) {
    res.status(400).json({ message: 'userId or email is required' });
    return;
  }

  await authService.cancelRegistration({ userId, email });
  res.status(200).json({ success: true, message: 'Unverified registration cancelled' });
});