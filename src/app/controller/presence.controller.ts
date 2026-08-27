// src/controllers/presence.controller.ts
//
// CONTROLLER LAYER
// -----------------
// Reads req, calls the service, writes the HTTP response. No SQL, no
// Supabase calls, no business rules — just translating HTTP <-> service.

import type { Request, Response } from 'express';
import * as presenceService from '../services/presence.service';
import { asyncHandler } from '../utils/asyncHandler';

// POST /presence/heartbeat
export const heartbeat = asyncHandler(async (req: Request, res: Response) => {
  await presenceService.heartbeat(req.userId as string);
  res.status(204).send();
});

// GET /presence/online
export const online = asyncHandler(async (req: Request, res: Response) => {
  const result = await presenceService.listOnline();
  res.status(200).json(result);
});
