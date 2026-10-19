// src/app/controller/game.controller.ts
//
// CONTROLLER LAYER — HTTP <-> game.service. No game rules or SQL in here.

import type { Request, Response } from 'express';
import * as gameService from '../services/game.service';
import { asyncHandler } from '../utils/asyncHandler';

// POST /games/invite   { friendId, gameId }
export const invite = asyncHandler(async (req: Request, res: Response) => {
  const session = await gameService.createInvite(req.userId as string, req.body?.friendId, req.body?.gameId);
  res.status(201).json({ session });
});

// POST /games/:id/accept
export const accept = asyncHandler(async (req: Request, res: Response) => {
  const session = await gameService.acceptInvite(String(req.params.id), req.userId as string);
  res.status(200).json({ session });
});

// POST /games/:id/decline
export const decline = asyncHandler(async (req: Request, res: Response) => {
  const session = await gameService.declineInvite(String(req.params.id), req.userId as string);
  res.status(200).json({ session });
});

// POST /games/:id/cancel
export const cancel = asyncHandler(async (req: Request, res: Response) => {
  const session = await gameService.cancelInvite(String(req.params.id), req.userId as string);
  res.status(200).json({ session });
});

// GET /games/open  → { active, invites }
export const open = asyncHandler(async (req: Request, res: Response) => {
  res.status(200).json(await gameService.getMyOpenState(req.userId as string));
});

// GET /games/leaderboard?game=ttt&scope=global|friends&limit=50
export const leaderboard = asyncHandler(async (req: Request, res: Response) => {
  const scope = req.query.scope === 'friends' ? 'friends' : 'global';
  const limit = Number(req.query.limit) || 50;
  res.status(200).json(await gameService.getLeaderboard(req.userId as string, req.query.game, scope, limit));
});

// GET /games/me/stats
export const myStats = asyncHandler(async (req: Request, res: Response) => {
  res.status(200).json(await gameService.getMyStats(req.userId as string));
});

// GET /games/:id
export const getOne = asyncHandler(async (req: Request, res: Response) => {
  const session = await gameService.getSession(String(req.params.id), req.userId as string);
  res.status(200).json({ session });
});
