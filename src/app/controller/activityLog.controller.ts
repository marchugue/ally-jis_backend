// src/app/controller/activityLog.controller.ts

import type { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import * as activityLogService from '../services/activityLog.service';
import type { ActivityBucket } from '../models/activityLog.model';

export const listActivities = asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user?.id || (req as any).userId;
  const bucket = req.query.bucket as ActivityBucket | 'all' | undefined;
  const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;

  const result = await activityLogService.getUserActivityLogs(userId, {
    bucket,
    cursor,
    limit,
  });

  res.json({
    success: true,
    data: result,
  });
});

export const deleteActivity = asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user?.id || (req as any).userId;
  const { id } = req.params;

  const deleted = await activityLogService.deleteUserActivityLog(userId, id);
  if (!deleted) {
    res.status(404).json({ success: false, message: 'Activity log not found or already deleted' });
    return;
  }

  res.json({
    success: true,
    message: 'Activity log deleted',
  });
});

export const clearActivities = asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user?.id || (req as any).userId;
  const bucket = req.query.bucket as ActivityBucket | undefined;

  const cleared = await activityLogService.clearUserActivityLogs(userId, bucket);

  res.json({
    success: cleared,
    message: bucket ? `Cleared ${bucket} activity logs` : 'Cleared all activity logs',
  });
});
