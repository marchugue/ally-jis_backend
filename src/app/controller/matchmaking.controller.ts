// src/controllers/matchmaking.controller.ts
//
// CONTROLLER LAYER
// -----------------
// Reads req, calls the service, writes the HTTP response. No SQL, no
// Supabase calls, no business rules.

import type { Request, Response } from 'express';
import * as matchmakingService from '../services/matchmaking.service';
import { asyncHandler } from '../utils/asyncHandler';

// POST /matchmaking/queue
export const joinQueue = asyncHandler(async (req: Request, res: Response) => {
  const entry = await matchmakingService.joinQueue(req.userId as string);
  res.status(200).json(entry);
});

// DELETE /matchmaking/queue
export const leaveQueue = asyncHandler(async (req: Request, res: Response) => {
  await matchmakingService.leaveQueue(req.userId as string);
  res.status(204).send();
});

// GET /matchmaking/status
export const getStatus = asyncHandler(async (req: Request, res: Response) => {
  const status = await matchmakingService.getStatus(req.userId as string);
  res.status(200).json(status);
});

// POST /matchmaking/:matchId/accept
export const acceptMatch = asyncHandler(async (req: Request, res: Response) => {
  const { matchId } = req.params as { matchId: string };
  const userId = req.userId as string;
  const match = await matchmakingService.acceptMatch(matchId, userId);
  // Included alongside the room_ready socket event (not instead of it) as
  // a fallback for a client that missed the socket event mid-reconnect.
  const identity = await matchmakingService.getMatchIdentity(matchId, userId);
  res.status(200).json({ ...match, identity });
});

// POST /matchmaking/:matchId/decline
export const declineMatch = asyncHandler(async (req: Request, res: Response) => {
  const { matchId } = req.params as { matchId: string };
  await matchmakingService.declineMatch(matchId, req.userId as string);
  res.status(204).send();
});

// POST /matchmaking/:matchId/end
export const endMatch = asyncHandler(async (req: Request, res: Response) => {
  const { matchId } = req.params as { matchId: string };
  const match = await matchmakingService.endMatch(matchId, req.userId as string);
  res.status(200).json(match);
});