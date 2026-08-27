// src/controllers/auth.controller.ts
//
// CONTROLLER LAYER
// -----------------
// Reads req, calls the service, writes the HTTP response. No SQL, no
// Supabase calls, no business rules — just translating HTTP <-> service.

import type { Request, Response } from 'express';
import * as authService from '../services/auth.service';
import { asyncHandler } from '../utils/asyncHandler';
import type { LoginPayload, RegisterPayload } from '../types/auth.types';
import { env } from '../../config/env';

export const register = asyncHandler(async (req: Request, res: Response) => {
  const payload = req.body as RegisterPayload;
  const session = await authService.register(payload);
  res.status(201).json(session);
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

// POST /auth/confirm
// Accepts the token_hash Supabase embeds in the confirmation-email link.
// The frontend ConfirmPage POSTs it here; we verify it with Supabase and
// return a session so the user is logged in immediately after confirming.
export const confirmEmail = asyncHandler(async (req: Request, res: Response) => {
  const { token_hash } = req.body as { token_hash: string };
  if (!token_hash) {
    res.status(400).json({ error: 'token_hash is required' });
    return;
  }
  const session = await authService.confirmEmail(token_hash);
  res.status(200).json(session);
});