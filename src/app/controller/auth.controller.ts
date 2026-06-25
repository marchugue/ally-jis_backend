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