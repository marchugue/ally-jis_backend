// src/app/controller/adminUsers.controller.ts

import type { Request, Response } from 'express';
import * as adminUsersService from '../services/adminUsers.service';
import { asyncHandler } from '../utils/asyncHandler';
import type { ListUsersParams } from '../types/adminUsers.types';

// GET /admin/users
export const listUsers = asyncHandler(async (req: Request, res: Response) => {
  const params: ListUsersParams = {
    search: typeof req.query.search === 'string' ? req.query.search : undefined,
    status: (req.query.status as ListUsersParams['status']) ?? 'all',
    department: typeof req.query.department === 'string' ? req.query.department : undefined,
    sortBy: (req.query.sortBy as ListUsersParams['sortBy']) ?? 'created_at',
    sortDir: (req.query.sortDir as ListUsersParams['sortDir']) ?? 'desc',
    cursor: typeof req.query.cursor === 'string' ? req.query.cursor : null,
    limit: req.query.limit ? Number(req.query.limit) : undefined,
  };
  const result = await adminUsersService.listUsers(params);
  res.status(200).json(result);
});

// GET /admin/users/:userId
export const getUserDetail = asyncHandler(async (req: Request, res: Response) => {
  const user = await adminUsersService.getUserDetail(String(req.params.userId));
  res.status(200).json(user);
});

// PATCH /admin/users/:userId
export const updateUser = asyncHandler(async (req: Request, res: Response) => {
  await adminUsersService.updateUser(req.userId as string, String(req.params.userId), req.body, req.ip);
  res.status(204).send();
});

// POST /admin/users/:userId/ban
export const banUser = asyncHandler(async (req: Request, res: Response) => {
  await adminUsersService.banUser(req.userId as string, String(req.params.userId), req.ip);
  res.status(204).send();
});

// POST /admin/users/:userId/unban
export const unbanUser = asyncHandler(async (req: Request, res: Response) => {
  await adminUsersService.unbanUser(req.userId as string, String(req.params.userId), req.ip);
  res.status(204).send();
});

// POST /admin/users/:userId/suspend  { until?: string }
export const suspendUser = asyncHandler(async (req: Request, res: Response) => {
  const { until } = req.body as { until?: string };
  await adminUsersService.suspendUser(req.userId as string, String(req.params.userId), until ?? null, req.ip);
  res.status(204).send();
});

// POST /admin/users/:userId/unsuspend
export const unsuspendUser = asyncHandler(async (req: Request, res: Response) => {
  await adminUsersService.unsuspendUser(req.userId as string, String(req.params.userId), req.ip);
  res.status(204).send();
});

// POST /admin/users/:userId/verify
export const verifyUser = asyncHandler(async (req: Request, res: Response) => {
  await adminUsersService.verifyUser(req.userId as string, String(req.params.userId), req.ip);
  res.status(204).send();
});

// POST /admin/users/:userId/unverify
export const unverifyUser = asyncHandler(async (req: Request, res: Response) => {
  await adminUsersService.unverifyUser(req.userId as string, String(req.params.userId), req.ip);
  res.status(204).send();
});

// POST /admin/users/:userId/force-logout
export const forceLogout = asyncHandler(async (req: Request, res: Response) => {
  await adminUsersService.forceLogout(req.userId as string, String(req.params.userId), req.ip);
  res.status(204).send();
});

// POST /admin/users/:userId/reset-password
export const resetUserPassword = asyncHandler(async (req: Request, res: Response) => {
  await adminUsersService.resetUserPassword(req.userId as string, String(req.params.userId), req.ip);
  res.status(204).send();
});

// DELETE /admin/users/:userId
export const deleteUser = asyncHandler(async (req: Request, res: Response) => {
  await adminUsersService.deleteUser(req.userId as string, String(req.params.userId), req.ip);
  res.status(204).send();
});

// GET /admin/users/pending-verifications
export const listPendingVerifications = asyncHandler(async (req: Request, res: Response) => {
  const result = await adminUsersService.listPendingVerifications();
  res.status(200).json(result);
});

// POST /admin/users/:userId/approve-verification
export const approveStudentVerification = asyncHandler(async (req: Request, res: Response) => {
  await adminUsersService.approveStudentVerification(req.userId as string, String(req.params.userId), req.ip);
  res.status(204).send();
});

// POST /admin/users/:userId/reject-verification  { reason?: string }
export const rejectStudentVerification = asyncHandler(async (req: Request, res: Response) => {
  const { reason } = req.body as { reason?: string };
  await adminUsersService.rejectStudentVerification(req.userId as string, String(req.params.userId), reason, req.ip);
  res.status(204).send();
});
