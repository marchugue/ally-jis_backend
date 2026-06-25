// src/controllers/conversation.controller.ts
//
// CONTROLLER LAYER
// -----------------
// Reads req, calls the service, writes the HTTP response. No SQL, no
// Supabase calls, no business rules — just translating HTTP <-> service.

import type { Request, Response } from 'express';
import * as conversationService from '../services/conversation.service';
import { asyncHandler } from '../utils/asyncHandler';
import type { CreateConversationPayload, MarkReadPayload, SendMessagePayload } from '../types/conversation.types';

// GET /conversations
export const list = asyncHandler(async (req: Request, res: Response) => {
  const conversations = await conversationService.listMyConversations(req.userId as string);
  res.status(200).json(conversations);
});

// GET /conversations/:id
export const getById = asyncHandler(async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const conversation = await conversationService.getConversationById(id, req.userId as string);
  res.status(200).json(conversation);
});

// POST /conversations
export const create = asyncHandler(async (req: Request, res: Response) => {
  const { targetUserId } = req.body as CreateConversationPayload;
  const result = await conversationService.getOrCreateConversation(req.userId as string, targetUserId);
  res.status(200).json(result);
});

// PATCH /conversations/:id/read
export const markRead = asyncHandler(async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const { readAt } = req.body as MarkReadPayload;
  await conversationService.markConversationRead(id, req.userId as string, readAt);
  res.status(204).send();
});

// GET /conversations/with-user/:otherUserId
export const getWithUser = asyncHandler(async (req: Request, res: Response) => {
  const otherUserId = String(req.params.otherUserId);
  const result = await conversationService.getConversationWithUser(req.userId as string, otherUserId);
  res.status(200).json(result);
});

// GET /conversations/memberships/me
export const myMemberships = asyncHandler(async (req: Request, res: Response) => {
  const memberships = await conversationService.listMyMemberships(req.userId as string);
  res.status(200).json(memberships);
});

// GET /conversations/:id/messages
export const listMessages = asyncHandler(async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const messages = await conversationService.listMessages(id, req.userId as string);
  res.status(200).json(messages);
});

// POST /conversations/:id/messages
export const sendMessage = asyncHandler(async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const { content, imageUrl } = req.body as SendMessagePayload;

  const message = await conversationService.sendMessage({
    conversationId: id,
    senderId: req.userId as string,
    content: content ?? null,
    imageUrl,
  });

  res.status(201).json(message);
});
