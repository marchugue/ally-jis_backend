// src/controllers/interaction.controller.ts
//
// CONTROLLER LAYER
// -----------------
// Reads req, calls the service, writes the HTTP response. No SQL, no
// Supabase calls, no business rules — just translating HTTP <-> service.

import type { Request, Response } from 'express';
import * as interactionService from '../services/interaction.service';
import { asyncHandler } from '../utils/asyncHandler';
import type {
  AcceptInteractionPayload,
  IncomingInteractionsPayload,
  RejectInteractionPayload,
  RequestInteractionPayload,
} from '../types/interaction.types';

// GET /interactions
export const list = asyncHandler(async (req: Request, res: Response) => {
  const interactions = await interactionService.listMyInteractions(req.userId as string);
  res.status(200).json(interactions);
});

// POST /interactions/incoming
export const incoming = asyncHandler(async (req: Request, res: Response) => {
  const { requesterIds } = req.body as IncomingInteractionsPayload;
  const interactions = await interactionService.listIncoming(req.userId as string, requesterIds ?? []);
  res.status(200).json(interactions);
});

// POST /interactions/request
export const request = asyncHandler(async (req: Request, res: Response) => {
  const { targetUserId } = req.body as RequestInteractionPayload;
  await interactionService.requestConnection(req.userId as string, targetUserId);
  res.status(204).send();
});

// POST /interactions/accept
export const accept = asyncHandler(async (req: Request, res: Response) => {
  const { requesterId } = req.body as AcceptInteractionPayload;
  const result = await interactionService.acceptConnection(req.userId as string, requesterId);
  res.status(200).json(result);
});

// POST /interactions/reject
export const reject = asyncHandler(async (req: Request, res: Response) => {
  const { targetUserId } = req.body as RejectInteractionPayload;
  await interactionService.rejectConnection(req.userId as string, targetUserId);
  res.status(204).send();
});

// GET /interactions/status/:targetUserId
export const status = asyncHandler(async (req: Request, res: Response) => {
  const targetUserId = String(req.params.targetUserId);
  const result = await interactionService.getConnectionStatus(req.userId as string, targetUserId);
  res.status(200).json(result);
});
