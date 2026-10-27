// src/app/models/adminUsers.model.ts
//
// Deliberately avoids Supabase's embedded-relation join syntax for
// profiles <-> user_presence (see follow.model.ts's note on the same
// tradeoff for the follows<->profiles FKs) — two narrow queries merged
// in Node, since the result set here is always page-sized (<=100 rows),
// not a place where an extra round trip matters.

import { supabaseAdmin } from '../../config/supabase';
import { delCache } from '../utils/cache';
import type { AdminUserDetail, AdminUserListItem, ListUsersParams } from '../types/adminUsers.types';

const LIST_COLUMNS =
  'id, username, full_name, email, avatar_url, department, course, year_level, role, is_banned, is_suspended, suspended_until, admin_verified, created_at, email_type, chmsu_auto_verified, pending_student_verification, student_verification_status, student_id_url, student_id_back_url';

export function resolveRealFullName(row: any): string {
  if (!row) return 'Student';

  // 1. If full_name is present and is a distinct real name (not "anonymous", not "Anonymous Peer")
  if (row.full_name && typeof row.full_name === 'string') {
    const fn = row.full_name.trim();
    const lowerFn = fn.toLowerCase();
    if (lowerFn !== 'anonymous' && lowerFn !== 'anonymous peer' && lowerFn !== 'unnamed') {
      // If it doesn't match the lowercase username, it's likely a real name
      if (!row.username || lowerFn !== row.username.toLowerCase().trim()) {
        return fn;
      }
    }
  }

  // 2. Derive legal name from CHMSU institutional email (firstname.lastname@chmsu.edu.ph)
  if (row.email && typeof row.email === 'string' && row.email.toLowerCase().endsWith('@chmsu.edu.ph')) {
    const local = row.email.split('@')[0];
    const parts = local.split(/[._-]/).filter(Boolean);
    if (parts.length > 0) {
      return parts.map((p: string) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join(' ');
    }
  }

  // 3. If full_name exists and is not anonymous
  if (row.full_name && typeof row.full_name === 'string') {
    const fn = row.full_name.trim();
    const lowerFn = fn.toLowerCase();
    if (lowerFn !== 'anonymous' && lowerFn !== 'anonymous peer' && lowerFn !== 'unnamed') {
      return fn;
    }
  }

  // 4. If username exists and is not anonymous
  if (row.username && typeof row.username === 'string') {
    const un = row.username.trim();
    if (un.toLowerCase() !== 'anonymous') {
      return un;
    }
  }

  // 5. Fallback to email username
  if (row.email && typeof row.email === 'string') {
    return row.email.split('@')[0];
  }

  return 'Student';
}

async function attachLastSeen(users: any[]): Promise<AdminUserListItem[]> {
  if (users.length === 0) return [];
  const { data, error } = await supabaseAdmin
    .from('user_presence')
    .select('user_id, last_seen_at')
    .in('user_id', users.map((u) => u.id));
  if (error) throw error;
  const byId = new Map((data ?? []).map((r) => [r.user_id, r.last_seen_at as string]));
  return users.map((u) => ({
    ...u,
    full_name: resolveRealFullName(u),
    last_seen_at: byId.get(u.id) ?? null
  }));
}

export async function listUsers(params: ListUsersParams): Promise<{ items: AdminUserListItem[]; total: number }> {
  const { search, status = 'all', department, sortBy = 'created_at', sortDir = 'desc', cursor, limit = 20 } = params;
  const offset = cursor ? Number(cursor) || 0 : 0;

  let query = supabaseAdmin.from('profiles').select(LIST_COLUMNS, { count: 'exact' }).eq('role', 'student');

  if (search) {
    const term = search.replace(/[%_]/g, '');
    query = query.or(`username.ilike.%${term}%,full_name.ilike.%${term}%,email.ilike.%${term}%`);
  }
  if (status === 'banned') query = query.eq('is_banned', true);
  else if (status === 'suspended') query = query.eq('is_suspended', true);
  else if (status === 'pending') query = query.eq('admin_verified', false).eq('chmsu_auto_verified', false).or('student_verification_status.eq.pending,pending_student_verification.eq.true,email_type.eq.external');
  else if (status === 'verified') query = query.or('admin_verified.eq.true,chmsu_auto_verified.eq.true,student_verification_status.eq.approved');
  else if (status === 'active') query = query.eq('is_banned', false).eq('is_suspended', false);
  if (department) query = query.eq('department', department);

  query = query.order(sortBy, { ascending: sortDir === 'asc' }).range(offset, offset + limit - 1);

  const { data, error, count } = await query;
  if (error) throw error;

  const items = await attachLastSeen(data ?? []);
  return { items, total: count ?? 0 };
}

export async function getUserDetail(userId: string): Promise<AdminUserDetail | null> {
  const { data: profile, error } = await supabaseAdmin
    .from('profiles')
    .select(
      `${LIST_COLUMNS}, bio, interests, organizations, banned_at, email_type, chmsu_auto_verified, pending_student_verification, student_verification_status, student_id_url, student_id_back_url`,
    )
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  if (!profile) return null;

  let student_id_url = (profile as any).student_id_url;
  let student_id_back_url = (profile as any).student_id_back_url;
  let student_verification_status = (profile as any).student_verification_status;
  let pending_student_verification = (profile as any).pending_student_verification;
  let authFullName: string | null = null;

  // Fallback to Supabase Auth user_metadata if profile column is empty
  try {
    const { data: authUserData } = await supabaseAdmin.auth.admin.getUserById(userId);
    if (authUserData?.user?.user_metadata) {
      const meta = authUserData.user.user_metadata;
      if (meta.full_name && typeof meta.full_name === 'string') {
        authFullName = meta.full_name;
      }
      if (!student_id_url && meta.student_id_url) {
        student_id_url = meta.student_id_url;
      }
      if (!student_id_back_url && meta.student_id_back_url) {
        student_id_back_url = meta.student_id_back_url;
      }
      if (!student_verification_status && meta.student_verification_status) {
        student_verification_status = meta.student_verification_status;
      }
      if (pending_student_verification === undefined && meta.pending_student_verification !== undefined) {
        pending_student_verification = meta.pending_student_verification;
      }
    }
  } catch (authErr) {
    console.error('Failed to fetch auth user_metadata in getUserDetail:', authErr);
  }

  const [presence, postsCount, reportsCount] = await Promise.all([
    supabaseAdmin.from('user_presence').select('last_seen_at').eq('user_id', userId).maybeSingle(),
    supabaseAdmin.from('posts').select('id', { count: 'exact', head: true }).eq('author_id', userId),
    supabaseAdmin.from('reports').select('id', { count: 'exact', head: true }).eq('reported_user_id', userId),
  ]);

  const resolvedName = resolveRealFullName({
    ...profile,
    full_name: (profile as any).full_name || authFullName,
  });

  return {
    ...(profile as any),
    full_name: resolvedName,
    student_id_url: student_id_url ?? null,
    student_id_back_url: student_id_back_url ?? null,
    student_verification_status: student_verification_status ?? 'pending',
    pending_student_verification: pending_student_verification ?? false,
    last_seen_at: presence.data?.last_seen_at ?? null,
    postsCount: postsCount.count ?? 0,
    reportsAgainstCount: reportsCount.count ?? 0,
  };
}

export async function setBanned(userId: string, banned: boolean): Promise<void> {
  const { error } = await supabaseAdmin
    .from('profiles')
    .update({ is_banned: banned, banned_at: banned ? new Date().toISOString() : null })
    .eq('id', userId);
  if (error) throw error;
  void delCache([`cache:user:flags:${userId}`, `cache:profile:${userId}`, `cache:profile:summary:${userId}`]);
}

export async function setSuspended(userId: string, suspended: boolean, until: string | null): Promise<void> {
  const { error } = await supabaseAdmin
    .from('profiles')
    .update({ is_suspended: suspended, suspended_until: suspended ? until : null })
    .eq('id', userId);
  if (error) throw error;
  void delCache([`cache:user:flags:${userId}`, `cache:profile:${userId}`, `cache:profile:summary:${userId}`]);
}

export async function setAdminVerified(userId: string, verified: boolean): Promise<void> {
  const { error } = await supabaseAdmin.from('profiles').update({
    admin_verified: verified,
    student_verification_status: verified ? 'approved' : 'pending',
    pending_student_verification: !verified,
  }).eq('id', userId);
  if (error) throw error;
  void delCache([`cache:user:flags:${userId}`, `cache:profile:${userId}`, `cache:profile:summary:${userId}`]);
}

export async function invalidateSessions(userId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('profiles')
    .update({ session_invalidated_at: new Date().toISOString() })
    .eq('id', userId);
  if (error) throw error;
  void delCache([`cache:user:flags:${userId}`, `cache:profile:${userId}`, `cache:profile:summary:${userId}`]);
}

export async function updateProfileFields(userId: string, fields: Record<string, unknown>): Promise<void> {
  const { error } = await supabaseAdmin.from('profiles').update(fields).eq('id', userId);
  if (error) throw error;
  void delCache([`cache:user:flags:${userId}`, `cache:profile:${userId}`, `cache:profile:summary:${userId}`]);
}
