// src/app/services/adminReports.service.ts

import * as adminReportsModel from '../models/adminReports.model';
import * as adminModel from '../models/admin.model';
import * as adminUsersService from './adminUsers.service';
import { createNotification } from '../models/interaction.model';
import { HttpError } from '../types/auth.types';
import type { ListReportsParams, PaginatedReportList, ReportStatus } from '../types/adminReports.types';

async function log(adminId: string, action: string, targetUserId: string | null, ipAddress?: string, metadata?: Record<string, unknown>) {
  await adminModel.logAction({ adminId, action, targetUserId, metadata, ipAddress });
}

export async function listReports(params: ListReportsParams): Promise<PaginatedReportList> {
  const limit = params.limit ?? 20;
  const offset = params.cursor ? Number(params.cursor) || 0 : 0;
  const { items, total } = await adminReportsModel.listReports(params);
  const nextCursor = offset + limit < total ? String(offset + limit) : null;
  return { items, total, nextCursor };
}

export async function getReport(reportId: string) {
  const report = await adminReportsModel.getReportById(reportId);
  if (!report) throw new HttpError('Report not found', 404);
  return report;
}

export async function getStatusCounts() {
  return adminReportsModel.countByStatus();
}

export async function setStatus(adminId: string, reportId: string, status: ReportStatus, notes?: string, ip?: string): Promise<void> {
  const report = await adminReportsModel.getReportById(reportId);
  if (!report) throw new HttpError('Report not found', 404);
  await adminReportsModel.updateStatus(reportId, status, adminId, notes);
  await log(adminId, `report_${status}`, report.reported_user_id, ip, { reportId });
}

export async function setInternalNotes(adminId: string, reportId: string, notes: string, ip?: string): Promise<void> {
  await adminReportsModel.setInternalNotes(reportId, notes);
  await log(adminId, 'report_add_notes', null, ip, { reportId });
}

/** A warning is a notification, not a moderation-status change — deliberately
 * doesn't touch the report's own status, so an admin can warn without also
 * having to separately mark the report resolved. */
export async function warnUser(adminId: string, reportId: string, message: string, ip?: string): Promise<void> {
  const report = await adminReportsModel.getReportById(reportId);
  if (!report?.reported_user_id) throw new HttpError('Report has no reported user to warn', 400);

  await createNotification({
    userId: report.reported_user_id,
    type: 'admin_warning',
    title: 'Account Warning',
    description: message,
    fromUserId: null,
  });
  await log(adminId, 'warn_user', report.reported_user_id, ip, { reportId, message });
}

/** Thin pass-throughs so "Ban User" / "Suspend User" from a report use the
 * exact same ban/suspend implementation as User Management — one place
 * that actually bans someone, not two. */
export async function banReportedUser(adminId: string, reportId: string, ip?: string): Promise<void> {
  const report = await adminReportsModel.getReportById(reportId);
  if (!report?.reported_user_id) throw new HttpError('Report has no reported user', 400);
  await adminUsersService.banUser(adminId, report.reported_user_id, ip);
}

export async function suspendReportedUser(adminId: string, reportId: string, until: string | null, ip?: string): Promise<void> {
  const report = await adminReportsModel.getReportById(reportId);
  if (!report?.reported_user_id) throw new HttpError('Report has no reported user', 400);
  await adminUsersService.suspendUser(adminId, report.reported_user_id, until, ip);
}
