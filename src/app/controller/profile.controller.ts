// src/controllers/profile.controller.ts
//
// CONTROLLER LAYER
// -----------------
// Reads req, calls the service, writes the HTTP response. No SQL, no
// Supabase calls, no business rules — just translating HTTP <-> service.

import type { Request, Response } from 'express';
import * as profileService from '../services/profile.service';
import { asyncHandler } from '../utils/asyncHandler';
import type { BatchProfilesPayload, UpdateProfilePayload } from '../types/profile.types';

// GET /profiles/me
export const getMe = asyncHandler(async (req: Request, res: Response) => {
  const profile = await profileService.getProfile(req.userId as string);
  res.status(200).json(profile);
});

// GET /profiles/:userId
export const getById = asyncHandler(async (req: Request, res: Response) => {
  const userId = String(req.params.userId);
  const profile = await profileService.getProfile(userId);
  res.status(200).json(profile);
});

// GET /profiles?exclude={userId}
export const list = asyncHandler(async (req: Request, res: Response) => {
  const exclude = typeof req.query.exclude === 'string' ? req.query.exclude : null;
  const profiles = await profileService.listProfiles(exclude);
  res.status(200).json(profiles);
});

// POST /profiles/batch
export const batch = asyncHandler(async (req: Request, res: Response) => {
  const { ids } = req.body as BatchProfilesPayload;
  const profiles = await profileService.getProfilesByIds(ids ?? []);
  res.status(200).json(profiles);
});

// GET /profiles/check-username?username=x&excludeId=y
export const checkUsername = asyncHandler(async (req: Request, res: Response) => {
  const username = String(req.query.username ?? '');
  const excludeId = typeof req.query.excludeId === 'string' ? req.query.excludeId : null;

  const result = await profileService.checkUsernameAvailability(username, excludeId);
  res.status(200).json(result);
});

// PATCH /profiles/me
export const updateMe = asyncHandler(async (req: Request, res: Response) => {
  const payload = req.body as Partial<UpdateProfilePayload>;
  const profile = await profileService.updateProfile(req.userId as string, payload);
  res.status(200).json(profile);
});

// DELETE /profiles/me
export const deleteMe = asyncHandler(async (req: Request, res: Response) => {
  await profileService.deleteProfile(req.userId as string);
  res.status(204).send();
});