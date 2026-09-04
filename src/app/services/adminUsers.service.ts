// src/app/services/adminUsers.service.ts

import * as adminUsersModel from '../models/adminUsers.model';
import * as adminModel from '../models/admin.model';
import * as authModel from '../models/auth.model';
import * as profileModel from '../models/profile.model';
import { HttpError } from '../types/auth.types';
import { env } from '../../config/env';
import type { AdminUserDetail, ListUsersParams, PaginatedUserList } from '../types/adminUsers.types';

async function log(adminId: string, action: string, targetUserId: string, ipAddress?: string, metadata?: Record<string, unknown>) {
  await adminModel.logAction({ adminId, action, targetUserId, metadata, ipAddress });
}

export async function listUsers(params: ListUsersParams): Promise<PaginatedUserList> {
  const limit = params.limit ?? 20;
  const offset = params.cursor ? Number(params.cursor) || 0 : 0;
  const { items, total } = await adminUsersModel.listUsers(params);
  const nextCursor = offset + limit < total ? String(offset + limit) : null;
  return { items, total, nextCursor };
}

export async function getUserDetail(userId: string): Promise<AdminUserDetail> {
  const user = await adminUsersModel.getUserDetail(userId);
  if (!user) throw new HttpError('User not found', 404);
  return user;
}

export async function banUser(adminId: string, userId: string, ip?: string): Promise<void> {
  await adminUsersModel.setBanned(userId, true);
  await adminUsersModel.invalidateSessions(userId); // a ban should also end their current session
  await log(adminId, 'ban_user', userId, ip);
}

export async function unbanUser(adminId: string, userId: string, ip?: string): Promise<void> {
  await adminUsersModel.setBanned(userId, false);
  await log(adminId, 'unban_user', userId, ip);
}

export async function suspendUser(adminId: string, userId: string, until: string | null, ip?: string): Promise<void> {
  await adminUsersModel.setSuspended(userId, true, until);
  await adminUsersModel.invalidateSessions(userId);
  await log(adminId, 'suspend_user', userId, ip, { until });
}

export async function unsuspendUser(adminId: string, userId: string, ip?: string): Promise<void> {
  await adminUsersModel.setSuspended(userId, false, null);
  await log(adminId, 'unsuspend_user', userId, ip);
}

export async function verifyUser(adminId: string, userId: string, ip?: string): Promise<void> {
  await adminUsersModel.setAdminVerified(userId, true);
  await log(adminId, 'verify_user', userId, ip);
}

export async function unverifyUser(adminId: string, userId: string, ip?: string): Promise<void> {
  await adminUsersModel.setAdminVerified(userId, false);
  await log(adminId, 'unverify_user', userId, ip);
}

export async function forceLogout(adminId: string, userId: string, ip?: string): Promise<void> {
  await adminUsersModel.invalidateSessions(userId);
  await log(adminId, 'force_logout', userId, ip);
}

/** Sends a password-reset email rather than setting a password directly —
 * reuses the exact same flow a user would trigger themselves from the
 * login page (authModel.sendPasswordResetEmail), so there's one path for
 * "how does a password reset actually happen" in the whole codebase. */
export async function resetUserPassword(adminId: string, userId: string, ip?: string): Promise<void> {
  const user = await adminUsersModel.getUserDetail(userId);
  if (!user) throw new HttpError('User not found', 404);
  await authModel.sendPasswordResetEmail(user.email, env.PASSWORD_RESET_REDIRECT_URL);
  await log(adminId, 'reset_user_password', userId, ip);
}

export async function updateUser(adminId: string, userId: string, fields: Record<string, unknown>, ip?: string): Promise<void> {
  const ALLOWED = ['full_name', 'username', 'department', 'course', 'year_level', 'bio'];
  const filtered: Record<string, unknown> = {};
  for (const key of ALLOWED) if (key in fields) filtered[key] = fields[key];
  if (Object.keys(filtered).length === 0) return;

  await adminUsersModel.updateProfileFields(userId, filtered);
  await log(adminId, 'update_user', userId, ip, filtered);
}

/** Reuses the exact same deletion path as self-service account deletion
 * (profileService.deleteProfile -> profileModel.deleteByAuthUserId ->
 * supabaseAdmin.auth.admin.deleteUser) rather than a separate admin-only
 * delete function, so there's one proven "how does account deletion
 * actually work" path in the codebase. */
export async function deleteUser(adminId: string, userId: string, ip?: string): Promise<void> {
  await log(adminId, 'delete_user', userId, ip); // logged before deletion — target row won't exist to reference after
  await profileModel.deleteByAuthUserId(userId);
}

// ─── Student ID / Non-CHMSU Verification ─────────────────────────────────────

export interface PendingVerificationItem {
  id: string;
  username: string | null;
  full_name: string | null;
  email: string;
  avatar_url: string | null;
  department: string | null;
  course: string | null;
  student_id_url: string | null;
  student_verification_status: string;
  created_at: string;
}

export async function listPendingVerifications(): Promise<PendingVerificationItem[]> {
  const { supabaseAdmin } = await import('../../config/supabase');
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('id, username, full_name, email, avatar_url, department, course, student_id_url, student_verification_status, created_at')
    .or('student_verification_status.eq.pending,pending_student_verification.eq.true')
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Error fetching pending verifications:', error);
    throw error;
  }
  return (data ?? []) as PendingVerificationItem[];
}

export async function approveStudentVerification(adminId: string, userId: string, ip?: string): Promise<void> {
  const { supabaseAdmin } = await import('../../config/supabase');
  const { error } = await supabaseAdmin
    .from('profiles')
    .update({
      student_verification_status: 'approved',
      pending_student_verification: false,
      admin_verified: true,
    })
    .eq('id', userId);
  if (error) throw error;

  try {
    await supabaseAdmin.auth.admin.updateUserById(userId, {
      user_metadata: {
        student_verification_status: 'approved',
        admin_verified: true,
        is_approved: true,
        pending_student_verification: false,
      },
    });
  } catch (authErr) {
    console.warn('Could not update auth user_metadata on approval:', authErr);
  }

  await log(adminId, 'approve_student_verification', userId, ip);
}

export async function rejectStudentVerification(adminId: string, userId: string, reason?: string, ip?: string): Promise<void> {
  const { supabaseAdmin } = await import('../../config/supabase');
  const { error } = await supabaseAdmin
    .from('profiles')
    .update({
      student_verification_status: 'rejected',
      pending_student_verification: false,
      admin_verified: false,
    })
    .eq('id', userId);
  if (error) throw error;

  try {
    await supabaseAdmin.auth.admin.updateUserById(userId, {
      user_metadata: {
        student_verification_status: 'rejected',
        admin_verified: false,
        is_approved: false,
        pending_student_verification: false,
      },
    });
  } catch (authErr) {
    console.warn('Could not update auth user_metadata on rejection:', authErr);
  }

  await log(adminId, 'reject_student_verification', userId, ip, { reason });
}

