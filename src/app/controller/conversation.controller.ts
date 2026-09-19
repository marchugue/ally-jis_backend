// src/controllers/conversation.controller.ts
//
// CONTROLLER LAYER
// -----------------
// Reads req, calls the service, writes the HTTP response. No SQL, no
// Supabase calls, no business rules — just translating HTTP <-> service.

import type { Request, Response } from 'express';
import * as conversationService from '../services/conversation.service';
import { asyncHandler } from '../utils/asyncHandler';
import type { CreateConversationPayload, DeleteMessagePayload, MarkReadPayload, SendMessagePayload, SetMessageReactionPayload, UpdateIcebreakersPayload } from '../types/conversation.types';

// GET /conversations
export const list = asyncHandler(async (req: Request, res: Response) => {
  const limit = req.query.limit !== undefined ? Math.min(Math.max(parseInt(String(req.query.limit), 10) || 20, 1), 50) : undefined;
  const cursor = req.query.cursor ? String(req.query.cursor) : undefined;

  const result = await conversationService.listMyConversations(req.userId as string, { limit, cursor });

  if (limit !== undefined || cursor !== undefined) {
    res.status(200).json(result);
  } else {
    res.status(200).json(result.conversations);
  }
});
export const listConversations = list;

// GET /conversations/:id
export const getById = asyncHandler(async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const conversation = await conversationService.getConversationById(id, req.userId as string);
  res.status(200).json(conversation);
});

// DELETE /conversations/:id — hides it from the caller's chat list only
export const hide = asyncHandler(async (req: Request, res: Response) => {
  const id = String(req.params.id);
  await conversationService.hideConversation(id, req.userId as string);
  res.status(204).send();
});

// DELETE /conversations/:id/clear — permanently clears history for the caller
export const clear = asyncHandler(async (req: Request, res: Response) => {
  const id = String(req.params.id);
  await conversationService.clearConversation(id, req.userId as string);
  res.status(204).send();
});

// POST /conversations/:id/unhide — undoes a hide (the frontend's "Undo" toast)
export const unhide = asyncHandler(async (req: Request, res: Response) => {
  const id = String(req.params.id);
  await conversationService.unhideConversation(id, req.userId as string);
  res.status(204).send();
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
  const limit = req.query.limit !== undefined ? Math.min(Math.max(parseInt(String(req.query.limit), 10) || 30, 1), 100) : undefined;
  const before = req.query.before ? String(req.query.before) : undefined;

  const result = await conversationService.listMessages(id, req.userId as string, { limit, before });

  if (limit !== undefined || before !== undefined) {
    res.status(200).json(result);
  } else {
    res.status(200).json(result.messages);
  }
});

// POST /conversations/:id/messages
export const sendMessage = asyncHandler(async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const { content, imageUrl, imageUrls, replyToMessageId } = req.body as SendMessagePayload;

  const message = await conversationService.sendMessage({
    conversationId: id,
    senderId: req.userId as string,
    content: content ?? null,
    imageUrl,
    imageUrls,
    replyToMessageId: replyToMessageId ?? null,
  });

  res.status(201).json(message);
});

// PATCH /conversations/:id/icebreakers
export const updateIcebreakersEnabled = asyncHandler(async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const { enabled } = req.body as UpdateIcebreakersPayload;
  await conversationService.setIcebreakersEnabled(id, req.userId as string, enabled);
  res.status(204).send();
});

// GET /conversations/:id/icebreakers
export const getIcebreakersEnabled = asyncHandler(async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const data = await conversationService.getIcebreakersEnabled(id, req.userId as string);
  res.status(200).json({ data });
});

// PUT /conversations/:id/messages/:messageId/reactions
export const setMessageReaction = asyncHandler(async (req: Request, res: Response) => {
  const conversationId = String(req.params.id);
  const messageId = String(req.params.messageId);
  const { emoji } = req.body as SetMessageReactionPayload;

  const reactions = await conversationService.setMessageReaction({
    conversationId,
    messageId,
    userId: req.userId as string,
    emoji: emoji ?? null,
  });

  res.status(200).json(reactions);
});

// DELETE /conversations/:id/messages/:messageId
// Body: { mode: 'delete_for_me' | 'delete_for_everyone' }
export const deleteMessage = asyncHandler(async (req: Request, res: Response) => {
  const conversationId = String(req.params.id);
  const messageId = String(req.params.messageId);
  const { mode } = req.body as DeleteMessagePayload;

  if (mode === 'delete_for_everyone') {
    await conversationService.deleteMessageForEveryone(conversationId, messageId, req.userId as string);
  } else {
    await conversationService.deleteMessageForMe(conversationId, messageId, req.userId as string);
  }

  res.status(204).send();
});

// POST /conversations/:id/streak/restore
export const restoreStreak = asyncHandler(async (req: Request, res: Response) => {
  const conversationId = String(req.params.id);
  const result = await conversationService.restoreStreakForConversation(conversationId, req.userId as string);
  res.status(200).json(result);
});