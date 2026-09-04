// src/controllers/auth.controller.ts
//
// CONTROLLER LAYER
// -----------------
// Reads req, calls the service, writes the HTTP response. No SQL, no
// Supabase calls, no business rules — just translating HTTP <-> service.

import type { Request, Response } from 'express';
import * as authService from '../services/auth.service';
import * as otpService from '../services/otp.service';
import { asyncHandler } from '../utils/asyncHandler';
import { HttpError, type LoginPayload, type RegisterPayload } from '../types/auth.types';
import { env } from '../../config/env';
import { uploadToR2Storage } from '../../config/r2';

export const register = asyncHandler(async (req: Request, res: Response) => {
  const payload = req.body as RegisterPayload;
  const result = await authService.register(payload);
  // Returns { userId, email, accessToken: '' } — frontend navigates to OTP screen
  res.status(201).json(result);
});

export const login = asyncHandler(async (req: Request, res: Response) => {
  const { email, password } = req.body as LoginPayload;
  const session = await authService.login({ email, password });
  res.status(200).json(session);
});

export const logout = asyncHandler(async (req: Request, res: Response) => {
  await authService.logout(req.accessToken as string);
  res.status(204).send();
});

export const session = asyncHandler(async (req: Request, res: Response) => {
  const authSession = await authService.getSession(req.accessToken as string);
  res.status(200).json(authSession);
});

// POST /auth/forgot-password
export const forgotPassword = asyncHandler(async (req: Request, res: Response) => {
  const { email } = req.body as { email: string };
  await authService.forgotPassword(email, env.PASSWORD_RESET_REDIRECT_URL);
  res.status(204).send();
});

// POST /auth/reset-password
export const resetPassword = asyncHandler(async (req: Request, res: Response) => {
  const { token, password } = req.body as { token: string; password: string };
  await authService.resetPassword(token, password);
  res.status(204).send();
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

// POST /auth/otp/send — generate a new OTP and send it to the user's email
export const sendOtp = asyncHandler(async (req: Request, res: Response) => {
  const { userId, email } = req.body as { userId: string; email: string };
  if (!userId || !email) {
    res.status(400).json({ message: 'userId and email are required' });
    return;
  }
  await otpService.generateAndSendOtp(userId, email);
  res.status(204).send();
});

// POST /auth/otp/verify — verify the submitted OTP and return a session
export const verifyOtp = asyncHandler(async (req: Request, res: Response) => {
  const { userId, code } = req.body as { userId: string; code: string };
  if (!userId || !code) {
    res.status(400).json({ message: 'userId and code are required' });
    return;
  }
  // Verify the OTP (marks email confirmed in Supabase Auth on success)
  await otpService.verifyOtp(userId, code);

  // Build and return a real session now that the user is verified
  const session = await authService.buildSessionForUser(userId);
  res.status(200).json(session);
});

// POST /auth/otp/resend — resend with resend count tracking
export const resendOtp = asyncHandler(async (req: Request, res: Response) => {
  const { userId } = req.body as { userId: string };
  if (!userId) {
    res.status(400).json({ message: 'userId is required' });
    return;
  }
  const result = await otpService.resendOtp(userId);
  res.status(200).json(result);
});

// GET /auth/otp/status/:userId — returns OTP state without code
export const getOtpStatus = asyncHandler(async (req: Request, res: Response) => {
  const { userId } = req.params as { userId: string };
  const status = await otpService.getOtpStatus(userId);
  res.status(200).json(status);
});

// ─── Student ID Upload ────────────────────────────────────────────────────────

// POST /auth/student-id/upload — upload student ID image to R2
// The user must be registered (userId in body) but doesn't need a session yet.
export const uploadStudentId = asyncHandler(async (req: Request, res: Response) => {
  const { userId } = req.body as { userId: string };
  const file = req.file;

  if (!userId || !file) {
    res.status(400).json({ message: 'userId and file are required' });
    return;
  }

  const url = await authService.saveStudentIdUpload(userId, {
    buffer: file.buffer,
    originalname: file.originalname,
    mimetype: file.mimetype,
  });

  res.status(200).json({ url });
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
  const { userId } = req.body as { userId: string };
  if (!userId) {
    res.status(400).json({ message: 'userId is required' });
    return;
  }

  await authService.cancelRegistration(userId);
  res.status(204).send();
});