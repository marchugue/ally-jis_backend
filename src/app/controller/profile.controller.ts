// src/controllers/profile.controller.ts
//
// CONTROLLER LAYER
// -----------------
// Reads req, calls the service, writes the HTTP response. No SQL, no
// Supabase calls, no business rules — just translating HTTP <-> service.

import type { Request, Response } from 'express';
import * as profileService from '../services/profile.service';
import * as profileRelationshipService from '../services/profileRelationship.service';
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
  const profile = await profileService.getProfile(userId, req.userId as string);
  res.status(200).json(profile);
});

// GET /profiles/:userId/relationship
export const getRelationship = asyncHandler(async (req: Request, res: Response) => {
  const userId = String(req.params.userId);
  const summary = await profileRelationshipService.getRelationshipSummary(req.userId as string, userId);
  res.status(200).json(summary);
});

// GET /profiles?exclude={userId}&department=...&search=...&sortBy=match
export const list = asyncHandler(async (req: Request, res: Response) => {
  const exclude = typeof req.query.exclude === 'string' ? req.query.exclude : null;
  const search =
    typeof req.query.search === 'string'
      ? req.query.search
      : typeof req.query.q === 'string'
      ? req.query.q
      : undefined;
  const department = typeof req.query.department === 'string' ? req.query.department : undefined;
  const course = typeof req.query.course === 'string' ? req.query.course : undefined;
  const year_level =
    typeof req.query.year_level === 'string'
      ? req.query.year_level
      : typeof req.query.yearLevel === 'string'
      ? req.query.yearLevel
      : undefined;
  const interest = typeof req.query.interest === 'string' ? req.query.interest : undefined;
  const sortBy = typeof req.query.sortBy === 'string' ? (req.query.sortBy as any) : undefined;
  const limit = req.query.limit ? Number(req.query.limit) : undefined;
  const offset = req.query.offset ? Number(req.query.offset) : undefined;

  const profiles = await profileService.listProfiles({
    excludeId: exclude,
    viewerId: req.userId as string,
    search,
    department,
    course,
    year_level,
    interest,
    sortBy,
    limit,
    offset,
  });
  res.status(200).json(profiles);
});

// GET /profiles/discover
export const discover = asyncHandler(async (req: Request, res: Response) => {
  const search =
    typeof req.query.search === 'string'
      ? req.query.search
      : typeof req.query.q === 'string'
      ? req.query.q
      : undefined;
  const department = typeof req.query.department === 'string' ? req.query.department : undefined;
  const course = typeof req.query.course === 'string' ? req.query.course : undefined;
  const year_level =
    typeof req.query.year_level === 'string'
      ? req.query.year_level
      : typeof req.query.yearLevel === 'string'
      ? req.query.yearLevel
      : undefined;
  const interest = typeof req.query.interest === 'string' ? req.query.interest : undefined;
  const sortBy = typeof req.query.sortBy === 'string' ? (req.query.sortBy as any) : 'match';
  const limit = req.query.limit ? Number(req.query.limit) : undefined;
  const offset = req.query.offset ? Number(req.query.offset) : undefined;

  const profiles = await profileService.listProfiles({
    excludeId: req.userId as string,
    viewerId: req.userId as string,
    search,
    department,
    course,
    year_level,
    interest,
    sortBy,
    limit,
    offset,
  });
  res.status(200).json(profiles);
});

// POST /profiles/batch
export const batch = asyncHandler(async (req: Request, res: Response) => {
  const { ids } = req.body as BatchProfilesPayload;
  const profiles = await profileService.getProfilesByIds(ids ?? [], req.userId as string);
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

// POST /profiles/push-token
export const updatePushToken = asyncHandler(async (req: Request, res: Response) => {
  const { expoPushToken } = req.body as { expoPushToken?: string | null };
  const { savePushToken } = await import('../models/pushToken.model');
  await savePushToken(req.userId as string, expoPushToken ?? null);
  res.status(200).json({ ok: true });
});

// DELETE /profiles/me
export const deleteMe = asyncHandler(async (req: Request, res: Response) => {
  await profileService.deleteProfile(req.userId as string);
  res.status(204).send();
});