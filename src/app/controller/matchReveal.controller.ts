// src/app/controller/matchReveal.controller.ts

import type { Request, Response } from 'express';
import * as matchRevealService from '../services/matchReveal.service';
import * as matchTasksService from '../services/matchTasks.service';
import { asyncHandler } from '../utils/asyncHandler';

// GET /match/:matchId/reveal
export const getReveal = asyncHandler(async (req: Request, res: Response) => {
  const { matchId } = req.params as { matchId: string };
  const data = await matchRevealService.getReveal(matchId, req.userId as string);
  res.status(200).json(data);
});

// GET /match/:matchId/timeline
export const getTimeline = asyncHandler(async (req: Request, res: Response) => {
  const { matchId } = req.params as { matchId: string };
  const data = await matchRevealService.getTimeline(matchId, req.userId as string);
  res.status(200).json(data);
});

// POST /matchmaking/:matchId/tasks/:taskId/complete
export const completeTask = asyncHandler(async (req: Request, res: Response) => {
  const { matchId, taskId } = req.params as { matchId: string; taskId: string };
  const result = await matchTasksService.completeTask(matchId, req.userId as string, taskId);
  res.status(200).json(result);
});

