// src/controllers/notification.controller.ts
//
// CONTROLLER LAYER
// -----------------
// Reads req, calls the service, writes the HTTP response. No SQL, no
// Supabase calls, no business rules — just translating HTTP <-> service.

import type { Request, Response } from 'express';
import * as notificationService from '../services/notification.service';
import { asyncHandler } from '../utils/asyncHandler';

// GET /notifications?limit=20&category=...
export const list = asyncHandler(async (req: Request, res: Response) => {
  const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined;
  const category = typeof req.query.category === 'string' ? req.query.category : undefined;
  const notifications = await notificationService.listNotifications(req.userId as string, limit, category);
  res.status(200).json(notifications);
});

// GET /notifications/friend-requests
export const friendRequests = asyncHandler(async (req: Request, res: Response) => {
  const notifications = await notificationService.listFriendRequests(req.userId as string);
  res.status(200).json(notifications);
});

// GET /notifications/:id/redirection
export const getRedirection = asyncHandler(async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const redirection = await notificationService.resolveNotificationRedirection(id, req.userId as string);
  res.status(200).json(redirection);
});

// PATCH /notifications/read-target
export const readTarget = asyncHandler(async (req: Request, res: Response) => {
  const targetId = String(req.body?.targetId || req.body?.conversationId || req.query.targetId || '');
  if (targetId) {
    await notificationService.markTargetRead(targetId, req.userId as string);
  }
  res.status(204).send();
});

// PATCH /notifications/:id/read
export const markRead = asyncHandler(async (req: Request, res: Response) => {
  const id = String(req.params.id);
  await notificationService.markRead(id, req.userId as string);
  res.status(204).send();
});

// PATCH /notifications/read-all
export const markAllRead = asyncHandler(async (req: Request, res: Response) => {
  await notificationService.markAllRead(req.userId as string);
  res.status(204).send();
});

// DELETE /notifications
export const clearAll = asyncHandler(async (req: Request, res: Response) => {
  await notificationService.clearAllNotifications(req.userId as string);
  res.status(204).send();
});