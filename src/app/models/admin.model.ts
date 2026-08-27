// src/app/models/admin.model.ts

import { supabaseAdmin } from '../../config/supabase';
import type { AdminActivityLogRow, AdminRole, Permission, RolePermissionRow, TimeSeriesPoint } from '../types/admin.types';

export async function getUserRole(userId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin.from('profiles').select('role').eq('id', userId).maybeSingle();
  if (error) throw error;
  return (data as { role: string } | null)?.role ?? null;
}

export async function getRolePermissions(role: AdminRole): Promise<Permission[]> {
  const { data, error } = await supabaseAdmin.from('role_permissions').select('permission').eq('role', role);
  if (error) throw error;
  return (data ?? []).map((r) => r.permission as Permission);
}

export async function listRolePermissions(): Promise<RolePermissionRow[]> {
  const { data, error } = await supabaseAdmin.from('role_permissions').select('role, permission');
  if (error) throw error;
  return (data ?? []) as RolePermissionRow[];
}

export async function setRolePermission(role: AdminRole, permission: Permission, granted: boolean): Promise<void> {
  if (granted) {
    const { error } = await supabaseAdmin.from('role_permissions').upsert({ role, permission }, { onConflict: 'role,permission' });
    if (error) throw error;
  } else {
    const { error } = await supabaseAdmin.from('role_permissions').delete().eq('role', role).eq('permission', permission);
    if (error) throw error;
  }
}

const ADMIN_PROFILE_COLUMNS = 'id, username, full_name, avatar_url, email, role, created_at';

export async function listAdmins(): Promise<any[]> {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select(ADMIN_PROFILE_COLUMNS)
    .neq('role', 'student')
    .order('role', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function setUserRole(userId: string, role: string): Promise<void> {
  const { error } = await supabaseAdmin.from('profiles').update({ role }).eq('id', userId);
  if (error) throw error;
}

export async function logAction(entry: {
  adminId: string;
  action: string;
  targetUserId?: string | null;
  metadata?: Record<string, unknown> | null;
  ipAddress?: string | null;
}): Promise<void> {
  const { error } = await supabaseAdmin.from('admin_activity_log').insert({
    admin_id: entry.adminId,
    action: entry.action,
    target_user_id: entry.targetUserId ?? null,
    metadata: entry.metadata ?? null,
    ip_address: entry.ipAddress ?? null,
  });
  if (error) throw error;
}

export async function listActivityLog(limit: number, offset: number): Promise<AdminActivityLogRow[]> {
  const { data, error } = await supabaseAdmin
    .from('admin_activity_log')
    .select('*')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) throw error;
  return (data ?? []) as AdminActivityLogRow[];
}

// ---------------------------------------------------------------------------
// Dashboard KPIs — each a single count() query; run in parallel by the
// service layer via Promise.all rather than sequentially.
// ---------------------------------------------------------------------------

async function countProfiles(filters: (q: any) => any): Promise<number> {
  let query = supabaseAdmin.from('profiles').select('id', { count: 'exact', head: true });
  query = filters(query);
  const { count, error } = await query;
  if (error) throw error;
  return count ?? 0;
}

export async function countTotalUsers(): Promise<number> {
  return countProfiles((q) => q.eq('role', 'student'));
}

export async function countBannedUsers(): Promise<number> {
  return countProfiles((q) => q.eq('is_banned', true));
}

export async function countNewUsersSince(sinceIso: string): Promise<number> {
  return countProfiles((q) => q.gte('created_at', sinceIso));
}

export async function countActiveUsersSince(sinceIso: string): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from('user_presence')
    .select('user_id', { count: 'exact', head: true })
    .gte('last_seen_at', sinceIso);
  if (error) throw error;
  return count ?? 0;
}

export async function countReportedUsers(): Promise<number> {
  const { data, error } = await supabaseAdmin.from('reports').select('reported_user_id').not('reported_user_id', 'is', null);
  if (error) throw error;
  return new Set((data ?? []).map((r) => r.reported_user_id)).size;
}

export async function countPendingReports(): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from('reports')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending');
  if (error) throw error;
  return count ?? 0;
}

// ---------------------------------------------------------------------------
// Dashboard charts — 30-day time series, bucketed in Node from a single
// ranged fetch per metric rather than one query per day.
// ---------------------------------------------------------------------------

function bucketByDay(dates: string[], days: number): TimeSeriesPoint[] {
  const counts = new Map<string, number>();
  for (const iso of dates) {
    const day = iso.slice(0, 10);
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  const points: TimeSeriesPoint[] = [];
  const cursor = new Date();
  cursor.setUTCHours(0, 0, 0, 0);
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(cursor);
    d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    points.push({ date: key, count: counts.get(key) ?? 0 });
  }
  return points;
}

export async function getRegistrationTrend(days: number): Promise<TimeSeriesPoint[]> {
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - (days - 1));
  since.setUTCHours(0, 0, 0, 0);
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('created_at')
    .eq('role', 'student')
    .gte('created_at', since.toISOString());
  if (error) throw error;
  return bucketByDay((data ?? []).map((r) => r.created_at as string), days);
}

export async function getActiveUsersTrend(days: number): Promise<TimeSeriesPoint[]> {
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - (days - 1));
  since.setUTCHours(0, 0, 0, 0);
  const { data, error } = await supabaseAdmin
    .from('user_presence')
    .select('last_seen_at')
    .gte('last_seen_at', since.toISOString());
  if (error) throw error;
  return bucketByDay((data ?? []).map((r) => r.last_seen_at as string), days);
}

export async function getReportsTrend(days: number): Promise<TimeSeriesPoint[]> {
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - (days - 1));
  since.setUTCHours(0, 0, 0, 0);
  const { data, error } = await supabaseAdmin
    .from('reports')
    .select('created_at')
    .gte('created_at', since.toISOString());
  if (error) throw error;
  return bucketByDay((data ?? []).map((r) => r.created_at as string), days);
}
