// src/controllers/moderation.controller.ts
//
// CONTROLLER LAYER
// -----------------
// Reads req, calls the service, writes the HTTP response. No SQL, no
// Supabase calls, no business rules — just translating HTTP <-> service.

import type { Request, Response } from 'express';
import * as moderationService from '../services/moderation.service';
import { asyncHandler } from '../utils/asyncHandler';
import type { BlockUserPayload, ReportUserPayload } from '../types/moderation.types';

// POST /moderation/block
export const blockUser = asyncHandler(async (req: Request, res: Response) => {
  const { blockedUserId } = req.body as BlockUserPayload;
  const result = await moderationService.blockUser(req.userId as string, blockedUserId);
  res.status(200).json(result);
});

// POST /moderation/report
export const reportUser = asyncHandler(async (req: Request, res: Response) => {
  const payload = req.body as ReportUserPayload;
  const report = await moderationService.createReport(req.userId as string, payload);
  res.status(201).json(report);
});

// GET /moderation/blocked/:userId
export const checkBlocked = asyncHandler(async (req: Request, res: Response) => {
  const otherUserId = String(req.params.userId);
  const blocked = await moderationService.checkIsBlocked(req.userId as string, otherUserId);
  res.status(200).json({ blocked });
});

export const unblockUser = asyncHandler(async (req: Request, res: Response) => {
  const blockedUserId = String(req.params.userId);
  const result = await moderationService.unblockUser(req.userId as string, blockedUserId);
  res.status(200).json(result);
});

// GET /moderation/blocked
export const listBlocked = asyncHandler(async (req: Request, res: Response) => {
  const list = await moderationService.listBlockedUsers(req.userId as string);
  res.status(200).json(list);
});