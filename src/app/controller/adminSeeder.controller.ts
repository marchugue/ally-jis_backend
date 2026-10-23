// src/app/controller/adminSeeder.controller.ts

import type { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import * as adminSeederService from '../services/adminSeeder.service';
import { HttpError } from '../types/auth.types';

/**
 * GET /api/admin/seeder/conversations
 * Strictly protected for admins. Returns list of conversations with member profiles and match details.
 */
export const listConversationsForSeeder = asyncHandler(async (req: Request, res: Response) => {
  const limit = req.query.limit ? Math.min(Number(req.query.limit), 100) : 50;
  const conversations = await adminSeederService.listConversations(limit);
  res.status(200).json({ conversations });
});

/**
 * POST /api/admin/seeder/points
 * Strictly protected for admins. Seeds conversation points, recalculates stage/streak, and emits realtime sync.
 */
export const seedConversationPoints = asyncHandler(async (req: Request, res: Response) => {
  const adminId = req.userId;
  if (!adminId) {
    throw new HttpError('Unauthorized admin access', 401);
  }

  const { conversationId, points } = req.body ?? {};

  if (!conversationId || typeof conversationId !== 'string') {
    throw new HttpError('Valid conversationId is required', 400);
  }

  const parsedPoints = Number(points);
  if (isNaN(parsedPoints) || parsedPoints < 0) {
    throw new HttpError('Points must be a non-negative number', 400);
  }

  const result = await adminSeederService.seedConversationPoints(
    adminId,
    {
      conversationId: conversationId.trim(),
      points: Math.round(parsedPoints),
    },
    req.ip,
  );

  res.status(200).json({
    success: true,
    message: `Successfully seeded ${result.newPoints} points`,
    points: result.newPoints,
    stage: result.currentStage,
    dayStreak: result.dayStreak,
    isRevealed: result.isRevealed,
    result,
  });
});
