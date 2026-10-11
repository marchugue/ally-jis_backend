// src/app/models/activityLog.model.ts
//
// Model layer for Facebook-style User Activity Log.
// Provides persistent, chronologically indexed personal activity stream.

import { supabaseAdmin } from '../../config/supabase';

export type ActivityBucket = 'content' | 'connections' | 'security' | 'safety';

export interface ActivityLogRow {
  id: string;
  user_id: string;
  bucket: ActivityBucket;
  action: string;
  title: string;
  summary: string | null;
  target_type: string | null;
  target_id: string | null;
  device_info: string | null;
  ip_address: string | null;
  metadata: Record<string, any>;
  created_at: string;
}

export interface CreateActivityLogInput {
  userId: string;
  bucket: ActivityBucket;
  action: string;
  title: string;
  summary?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  deviceInfo?: string | null;
  ipAddress?: string | null;
  metadata?: Record<string, any>;
}

export interface ListActivityLogsParams {
  bucket?: ActivityBucket | 'all';
  limit?: number;
  cursor?: string; // ISO date string or offset
}

/**
 * Creates an activity log entry using Supabase admin client.
 */
export async function createActivityLog(input: CreateActivityLogInput): Promise<ActivityLogRow | null> {
  const payload = {
    user_id: input.userId,
    bucket: input.bucket,
    action: input.action,
    title: input.title,
    summary: input.summary ?? null,
    target_type: input.targetType ?? null,
    target_id: input.targetId ?? null,
    device_info: input.deviceInfo ?? null,
    ip_address: input.ipAddress ?? null,
    metadata: input.metadata ?? {},
  };

  const { data, error } = await supabaseAdmin
    .from('user_activity_logs')
    .insert(payload)
    .select('*')
    .maybeSingle();

  if (error) {
    console.error('[ActivityLog] Failed to insert activity log:', error);
    return null;
  }

  return data as ActivityLogRow;
}

/**
 * Lists user activity logs with optional bucket filter and cursor pagination.
 */
export async function listUserActivityLogs(
  userId: string,
  params: ListActivityLogsParams = {}
): Promise<{ items: ActivityLogRow[]; nextCursor?: string }> {
  const limit = Math.min(Math.max(params.limit || 20, 1), 50);

  let query = supabaseAdmin
    .from('user_activity_logs')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit + 1);

  if (params.bucket && params.bucket !== 'all') {
    query = query.eq('bucket', params.bucket);
  }

  if (params.cursor) {
    query = query.lt('created_at', params.cursor);
  }

  const { data, error } = await query;

  if (error) {
    console.error('[ActivityLog] Failed to list activity logs:', error);
    return { items: [] };
  }

  const rows = (data || []) as ActivityLogRow[];
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore && items.length > 0 ? items[items.length - 1].created_at : undefined;

  return { items, nextCursor };
}

/**
 * Deletes a single activity log entry owned by the user.
 */
export async function deleteUserActivityLog(userId: string, logId: string): Promise<boolean> {
  const { error } = await supabaseAdmin
    .from('user_activity_logs')
    .delete()
    .eq('id', logId)
    .eq('user_id', userId);

  if (error) {
    console.error('[ActivityLog] Failed to delete activity log:', error);
    return false;
  }
  return true;
}

/**
 * Clears an entire bucket or all activity logs for a user.
 */
export async function clearUserActivityLogs(
  userId: string,
  bucket?: ActivityBucket
): Promise<boolean> {
  let query = supabaseAdmin
    .from('user_activity_logs')
    .delete()
    .eq('user_id', userId);

  if (bucket) {
    query = query.eq('bucket', bucket);
  }

  const { error } = await query;
  if (error) {
    console.error('[ActivityLog] Failed to clear activity logs:', error);
    return false;
  }
  return true;
}
