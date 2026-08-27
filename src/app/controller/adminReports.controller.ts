// src/app/controller/adminReports.controller.ts

import type { Request, Response } from 'express';
import * as adminReportsService from '../services/adminReports.service';
import { asyncHandler } from '../utils/asyncHandler';
import type { ListReportsParams } from '../types/adminReports.types';

// GET /admin/reports
export const listReports = asyncHandler(async (req: Request, res: Response) => {
  const params: ListReportsParams = {
    status: (req.query.status as ListReportsParams['status']) ?? 'all',
    categoryId: typeof req.query.categoryId === 'string' ? req.query.categoryId : undefined,
    cursor: typeof req.query.cursor === 'string' ? req.query.cursor : null,
    limit: req.query.limit ? Number(req.query.limit) : undefined,
  };
  const result = await adminReportsService.listReports(params);
  res.status(200).json(result);
});

// GET /admin/reports/status-counts
export const getStatusCounts = asyncHandler(async (_req: Request, res: Response) => {
  const counts = await adminReportsService.getStatusCounts();
  res.status(200).json(counts);
});

// GET /admin/reports/:reportId
export const getReport = asyncHandler(async (req: Request, res: Response) => {
  const report = await adminReportsService.getReport(String(req.params.reportId));
  res.status(200).json(report);
});

// POST /admin/reports/:reportId/status  { status, notes? }
export const setStatus = asyncHandler(async (req: Request, res: Response) => {
  const { status, notes } = req.body as { status: any; notes?: string };
  await adminReportsService.setStatus(req.userId as string, String(req.params.reportId), status, notes, req.ip);
  res.status(204).send();
});

// PUT /admin/reports/:reportId/notes  { notes }
export const setInternalNotes = asyncHandler(async (req: Request, res: Response) => {
  const { notes } = req.body as { notes: string };
  await adminReportsService.setInternalNotes(req.userId as string, String(req.params.reportId), notes, req.ip);
  res.status(204).send();
});

// POST /admin/reports/:reportId/warn  { message }
export const warnUser = asyncHandler(async (req: Request, res: Response) => {
  const { message } = req.body as { message: string };
  await adminReportsService.warnUser(req.userId as string, String(req.params.reportId), message, req.ip);
  res.status(204).send();
});

// POST /admin/reports/:reportId/ban
export const banReportedUser = asyncHandler(async (req: Request, res: Response) => {
  await adminReportsService.banReportedUser(req.userId as string, String(req.params.reportId), req.ip);
  res.status(204).send();
});

// POST /admin/reports/:reportId/suspend  { until? }
export const suspendReportedUser = asyncHandler(async (req: Request, res: Response) => {
  const { until } = req.body as { until?: string };
  await adminReportsService.suspendReportedUser(req.userId as string, String(req.params.reportId), until ?? null, req.ip);
  res.status(204).send();
});
