// src/app/controller/follow.controller.ts

import type { Request, Response } from 'express';
import * as followService from '../services/follow.service';
import { asyncHandler } from '../utils/asyncHandler';

// POST /follows/:userId
export const followUser = asyncHandler(async (req: Request, res: Response) => {
  const targetUserId = String(req.params.userId);
  await followService.followUser(req.userId as string, targetUserId);
  res.status(204).send();
});

// DELETE /follows/:userId
export const unfollowUser = asyncHandler(async (req: Request, res: Response) => {
  const targetUserId = String(req.params.userId);
  await followService.unfollowUser(req.userId as string, targetUserId);
  res.status(204).send();
});

// GET /follows/status/:userId
export const getStatus = asyncHandler(async (req: Request, res: Response) => {
  const targetUserId = String(req.params.userId);
  const result = await followService.getFollowStatus(req.userId as string, targetUserId);
  res.status(200).json(result);
});

// GET /follows/counts/:userId
export const getCounts = asyncHandler(async (req: Request, res: Response) => {
  const targetUserId = String(req.params.userId);
  const result = await followService.getFollowCounts(targetUserId);
  res.status(200).json(result);
});

// GET /follows/:userId/followers?cursor=&limit=
export const listFollowers = asyncHandler(async (req: Request, res: Response) => {
  const targetUserId = String(req.params.userId);
  const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : null;
  const limit = req.query.limit ? Number(req.query.limit) : undefined;
  const result = await followService.listFollowers(targetUserId, cursor, limit);
  res.status(200).json(result);
});

// GET /follows/:userId/following?cursor=&limit=
export const listFollowing = asyncHandler(async (req: Request, res: Response) => {
  const targetUserId = String(req.params.userId);
  const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : null;
  const limit = req.query.limit ? Number(req.query.limit) : undefined;
  const result = await followService.listFollowing(targetUserId, cursor, limit);
  res.status(200).json(result);
});
