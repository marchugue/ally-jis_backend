// src/app/controller/admin.controller.ts

import type { Request, Response } from 'express';
import * as adminService from '../services/admin.service';
import * as adminSettingsService from '../services/adminSettings.service';
import { asyncHandler } from '../utils/asyncHandler';

// GET /admin/me — role + effective permissions for the current user.
// The frontend's route guard and nav both key off this.
export const getMe = asyncHandler(async (req: Request, res: Response) => {
  const permissions = await adminService.getEffectivePermissions(req.userId as string);
  res.status(200).json({ role: req.adminRole, permissions });
});

// GET /admin/dashboard/kpis
export const getDashboardKpis = asyncHandler(async (_req: Request, res: Response) => {
  const kpis = await adminService.getDashboardKpis();
  res.status(200).json(kpis);
});

// GET /admin/dashboard/charts
export const getDashboardCharts = asyncHandler(async (_req: Request, res: Response) => {
  const charts = await adminService.getDashboardCharts();
  res.status(200).json(charts);
});

// GET /admin/admins
export const listAdmins = asyncHandler(async (_req: Request, res: Response) => {
  const admins = await adminService.listAdmins();
  res.status(200).json(admins);
});

// POST /admin/admins/:userId/role  { role }
export const setUserRole = asyncHandler(async (req: Request, res: Response) => {
  const targetUserId = String(req.params.userId);
  const { role } = req.body as { role: string };
  await adminService.setUserRole(req.userId as string, targetUserId, role, req.ip);
  res.status(204).send();
});

// GET /admin/permissions
export const listRolePermissions = asyncHandler(async (_req: Request, res: Response) => {
  const rows = await adminService.listRolePermissions();
  res.status(200).json(rows);
});

// PUT /admin/permissions  { role, permission, granted }
export const setRolePermission = asyncHandler(async (req: Request, res: Response) => {
  const { role, permission, granted } = req.body as { role: any; permission: any; granted: boolean };
  await adminService.setRolePermission(req.userId as string, role, permission, granted, req.ip);
  res.status(204).send();
});

// GET /admin/activity-log?cursor=
export const listActivityLog = asyncHandler(async (req: Request, res: Response) => {
  const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : null;
  const result = await adminService.listActivityLog(cursor);
  res.status(200).json(result);
});

// GET /admin/settings
export const getSettings = asyncHandler(async (_req: Request, res: Response) => {
  const settings = await adminSettingsService.getAllSettings();
  res.status(200).json(settings);
});

// PUT /admin/settings
export const updateSettings = asyncHandler(async (req: Request, res: Response) => {
  await adminSettingsService.updateSettings(req.userId as string, req.body, req.ip);
  res.status(204).send();
});
