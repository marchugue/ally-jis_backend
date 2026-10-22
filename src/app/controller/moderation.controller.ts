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
  const body = (req.body ?? {}) as any;
  const reportedUserId = (body.reportedUserId || body.targetUserId || '').trim();
  const violationId = (body.violationId || body.reason || 'other').trim();

  if (!reportedUserId) {
    res.status(400).json({ error: 'reportedUserId is required' });
    return;
  }

  const payload: ReportUserPayload = {
    reportedUserId,
    violationId,
    conversationId: body.conversationId ?? null,
    postId: body.postId ?? null,
    messageId: body.messageId ?? null,
    notes: body.notes || body.details || null,
  };

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

// ─────────────────────────────────────────────────────────────────────────────
// Restrict Handlers
// ─────────────────────────────────────────────────────────────────────────────

// POST /moderation/restrict
export const restrictUser = asyncHandler(async (req: Request, res: Response) => {
  const restrictedUserId = String(req.body.restrictedUserId || req.body.targetUserId || '').trim();
  if (!restrictedUserId) {
    res.status(400).json({ error: 'restrictedUserId is required' });
    return;
  }
  const result = await moderationService.restrictUser(req.userId as string, restrictedUserId);
  res.status(200).json(result);
});

// DELETE /moderation/restrict/:userId
export const unrestrictUser = asyncHandler(async (req: Request, res: Response) => {
  const restrictedUserId = String(req.params.userId);
  const result = await moderationService.unrestrictUser(req.userId as string, restrictedUserId);
  res.status(200).json(result);
});

// GET /moderation/restricted/:userId
export const checkRestricted = asyncHandler(async (req: Request, res: Response) => {
  const otherUserId = String(req.params.userId);
  const status = await moderationService.checkIsRestricted(req.userId as string, otherUserId);
  res.status(200).json(status);
});

// GET /moderation/restricted
export const listRestricted = asyncHandler(async (req: Request, res: Response) => {
  const list = await moderationService.listRestrictedUsers(req.userId as string);
  res.status(200).json(list);
});

// ─────────────────────────────────────────────────────────────────────────────
// Mute Handlers
// ─────────────────────────────────────────────────────────────────────────────

// POST /moderation/mute
export const muteUser = asyncHandler(async (req: Request, res: Response) => {
  const mutedUserId = String(req.body.mutedUserId || req.body.targetUserId || '').trim();
  if (!mutedUserId) {
    res.status(400).json({ error: 'mutedUserId is required' });
    return;
  }
  const result = await moderationService.muteUser(req.userId as string, mutedUserId);
  res.status(200).json(result);
});

// DELETE /moderation/mute/:userId
export const unmuteUser = asyncHandler(async (req: Request, res: Response) => {
  const mutedUserId = String(req.params.userId);
  const result = await moderationService.unmuteUser(req.userId as string, mutedUserId);
  res.status(200).json(result);
});

// GET /moderation/muted/:userId
export const checkMuted = asyncHandler(async (req: Request, res: Response) => {
  const otherUserId = String(req.params.userId);
  const status = await moderationService.checkIsMuted(req.userId as string, otherUserId);
  res.status(200).json(status);
});

// GET /moderation/muted
export const listMuted = asyncHandler(async (req: Request, res: Response) => {
  const list = await moderationService.listMutedUsers(req.userId as string);
  res.status(200).json(list);
});