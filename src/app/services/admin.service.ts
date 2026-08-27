// src/app/services/admin.service.ts

import * as adminModel from '../models/admin.model';
import { HttpError } from '../types/auth.types';
import { hasImplicitAllPermissions, isAdminRole, ALL_PERMISSIONS } from '../constants/permissions';
import type { AdminRole, DashboardCharts, DashboardKpis, Permission } from '../types/admin.types';

export async function getEffectivePermissions(userId: string): Promise<Permission[]> {
  const role = await adminModel.getUserRole(userId);
  if (!role || !isAdminRole(role)) return [];
  if (hasImplicitAllPermissions(role)) return ALL_PERMISSIONS;
  return adminModel.getRolePermissions(role);
}

export async function hasPermission(userId: string, permission: Permission): Promise<boolean> {
  const permissions = await getEffectivePermissions(userId);
  return permissions.includes(permission);
}

export async function getDashboardKpis(): Promise<DashboardKpis> {
  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setUTCHours(0, 0, 0, 0);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);
  const startOfWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const startOfMonth = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [
    totalUsers,
    activeUsers,
    bannedUsers,
    reportedUsers,
    newUsersToday,
    onlineUsers,
    pendingReports,
    newUsersThisWeek,
    newUsersThisMonth,
  ] = await Promise.all([
    adminModel.countTotalUsers(),
    adminModel.countActiveUsersSince(sevenDaysAgo.toISOString()),
    adminModel.countBannedUsers(),
    adminModel.countReportedUsers(),
    adminModel.countNewUsersSince(startOfToday.toISOString()),
    adminModel.countActiveUsersSince(fiveMinutesAgo.toISOString()),
    adminModel.countPendingReports(),
    adminModel.countNewUsersSince(startOfWeek.toISOString()),
    adminModel.countNewUsersSince(startOfMonth.toISOString()),
  ]);

  return {
    totalUsers,
    activeUsers,
    bannedUsers,
    reportedUsers,
    newUsersToday,
    onlineUsers,
    pendingReports,
    newUsersThisWeek,
    newUsersThisMonth,
  };
}

export async function getDashboardCharts(): Promise<DashboardCharts> {
  const DAYS = 30;
  const [registrations, activeUsers, reportsTrend] = await Promise.all([
    adminModel.getRegistrationTrend(DAYS),
    adminModel.getActiveUsersTrend(DAYS),
    adminModel.getReportsTrend(DAYS),
  ]);
  return { registrations, activeUsers, reportsTrend };
}

export async function listAdmins() {
  return adminModel.listAdmins();
}

/**
 * Grants or changes an admin-tier role. Only callable by someone with
 * manage_admins (in practice: super_admin, since that's the only role
 * role_permissions grants it to by default) — enforced by the
 * requirePermission('manage_admins') middleware on the route, not here.
 */
export async function setUserRole(actingAdminId: string, targetUserId: string, role: string, ipAddress?: string): Promise<void> {
  if (actingAdminId === targetUserId) {
    throw new HttpError('You cannot change your own role', 409);
  }
  if (role !== 'student' && !isAdminRole(role)) {
    throw new HttpError('Invalid role', 400);
  }

  await adminModel.setUserRole(targetUserId, role);
  await adminModel.logAction({
    adminId: actingAdminId,
    action: 'set_user_role',
    targetUserId,
    metadata: { role },
    ipAddress,
  });
}

export async function listRolePermissions() {
  return adminModel.listRolePermissions();
}

export async function setRolePermission(actingAdminId: string, role: AdminRole, permission: Permission, granted: boolean, ipAddress?: string): Promise<void> {
  await adminModel.setRolePermission(role, permission, granted);
  await adminModel.logAction({
    adminId: actingAdminId,
    action: granted ? 'grant_role_permission' : 'revoke_role_permission',
    metadata: { role, permission },
    ipAddress,
  });
}

export async function listActivityLog(cursor: string | null, limit = 30) {
  const offset = cursor ? Number(cursor) || 0 : 0;
  const items = await adminModel.listActivityLog(limit + 1, offset);
  const hasMore = items.length > limit;
  return { items: items.slice(0, limit), nextCursor: hasMore ? String(offset + limit) : null };
}

export async function logAction(entry: {
  adminId: string;
  action: string;
  targetUserId?: string | null;
  metadata?: Record<string, unknown> | null;
  ipAddress?: string | null;
}): Promise<void> {
  await adminModel.logAction(entry);
}
