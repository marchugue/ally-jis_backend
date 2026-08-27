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

// DELETE /interactions/request/:targetUserId
export const cancel = asyncHandler(async (req: Request, res: Response) => {
  const targetUserId = String(req.params.targetUserId);
  await interactionService.cancelRequest(req.userId as string, targetUserId);
  res.status(204).send();
});

// DELETE /interactions/ally/:targetUserId
export const removeAlly = asyncHandler(async (req: Request, res: Response) => {
  const targetUserId = String(req.params.targetUserId);
  await interactionService.removeAlly(req.userId as string, targetUserId);
  res.status(204).send();
});

// GET /interactions/relationship/:targetUserId
export const relationship = asyncHandler(async (req: Request, res: Response) => {
  const targetUserId = String(req.params.targetUserId);
  const result = await interactionService.getRelationshipStatus(req.userId as string, targetUserId);
  res.status(200).json(result);
});

// GET /interactions/allies/:userId?cursor=&limit=
export const listAllies = asyncHandler(async (req: Request, res: Response) => {
  const targetUserId = String(req.params.userId);
  const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : null;
  const limit = req.query.limit ? Number(req.query.limit) : undefined;
  const result = await interactionService.listAllies(targetUserId, cursor, limit);
  res.status(200).json(result);
});

// GET /interactions/allies/:userId/count
export const alliesCount = asyncHandler(async (req: Request, res: Response) => {
  const targetUserId = String(req.params.userId);
  const count = await interactionService.getAlliesCount(targetUserId);
  res.status(200).json({ count });
});
