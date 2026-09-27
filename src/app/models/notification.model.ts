import { supabaseAdmin } from '../../config/supabase';
import type { NotificationRow } from '../types/notification.types';

const NOTIFICATION_COLUMNS = 'id, user_id, type, title, description, is_read, from_user_id, target_id, post_id, comment_id, created_at, from_user:profiles!from_user_id(id, avatar_url, full_name, username)';
const NOTIFICATION_COLUMNS_FALLBACK = 'id, user_id, type, title, description, is_read, from_user_id, created_at, from_user:profiles!from_user_id(id, avatar_url, full_name, username)';

function isMissingColumnError(error: any): boolean {
  if (!error) return false;
  return (
    error.code === 'PGRST204' ||
    error.code === '42703' ||
    Boolean(
      error.message?.includes('post_id') ||
      error.message?.includes('comment_id') ||
      error.message?.includes('target_id')
    )
  );
}

/**
 * GET /notifications?limit=20&category=...
 */
export async function findByUser(
  userId: string,
  limit: number,
  category?: string
): Promise<NotificationRow[]> {
  let queryBuilder = supabaseAdmin
    .from('notifications')
    .select(NOTIFICATION_COLUMNS)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (category && category !== 'all' && category !== 'unread') {
    // If the category column exists, we can filter by it, but we can also filter in service for resilience
  }

  const { data, error } = await queryBuilder;

  if (error) {
    if (isMissingColumnError(error)) {
      const fallback = await supabaseAdmin
        .from('notifications')
        .select(NOTIFICATION_COLUMNS_FALLBACK)
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(limit);
      if (fallback.error) throw fallback.error;
      return (fallback.data as NotificationRow[]) ?? [];
    }
    throw error;
  }
  return (data as NotificationRow[]) ?? [];
}

/**
 * Find single notification by ID
 */
export async function findById(id: string): Promise<NotificationRow | null> {
  const { data, error } = await supabaseAdmin
    .from('notifications')
    .select(NOTIFICATION_COLUMNS)
    .eq('id', id)
    .maybeSingle();

  if (error) {
    if (isMissingColumnError(error)) {
      const fallback = await supabaseAdmin
        .from('notifications')
        .select(NOTIFICATION_COLUMNS_FALLBACK)
        .eq('id', id)
        .maybeSingle();
      if (fallback.error) throw fallback.error;
      return (fallback.data as NotificationRow | null) ?? null;
    }
    throw error;
  }
  return (data as NotificationRow | null) ?? null;
}

/**
 * Find an existing unread notification for a conversation to update (Facebook-style collapse)
 */
export async function findUnreadByConversation(
  userId: string,
  conversationId: string
): Promise<NotificationRow | null> {
  const { data, error } = await supabaseAdmin
    .from('notifications')
    .select(NOTIFICATION_COLUMNS)
    .eq('user_id', userId)
    .eq('is_read', false)
    .in('type', ['message', 'anon_match'])
    .order('created_at', { ascending: false });

  if (error) {
    if (isMissingColumnError(error)) {
      const fallback = await supabaseAdmin
        .from('notifications')
        .select(NOTIFICATION_COLUMNS_FALLBACK)
        .eq('user_id', userId)
        .eq('is_read', false)
        .in('type', ['message', 'anon_match'])
        .order('created_at', { ascending: false });
      if (fallback.error) return null;
      const list = (fallback.data as NotificationRow[]) ?? [];
      return (
        list.find(
          (n) =>
            (n as any).target_id === conversationId ||
            n.description?.includes(conversationId)
        ) ?? null
      );
    }
    return null;
  }

  const list = (data as NotificationRow[]) ?? [];
  return (
    list.find(
      (n) =>
        (n as any).target_id === conversationId ||
        n.description?.includes(conversationId)
    ) ?? null
  );
}

/**
 * Find existing unread notification by group key
 */
export async function findUnreadByGroupKey(
  userId: string,
  groupKey: string
): Promise<NotificationRow | null> {
  const { data, error } = await supabaseAdmin
    .from('notifications')
    .select(NOTIFICATION_COLUMNS)
    .eq('user_id', userId)
    .eq('is_read', false)
    .order('created_at', { ascending: false });

  if (error) return null;
  const list = (data as NotificationRow[]) ?? [];
  return (
    list.find(
      (n) =>
        (n as any).group_key === groupKey ||
        n.description?.includes(`"groupKey":"${groupKey}"`)
    ) ?? null
  );
}

/**
 * Update an existing notification (e.g. title, description, unread_count, updated_at)
 */
export async function updateNotification(
  id: string,
  updates: Record<string, any>
): Promise<void> {
  const { error } = await supabaseAdmin
    .from('notifications')
    .update(updates)
    .eq('id', id);

  if (error) {
    // If optional columns failed, strip and retry
    const safeUpdates: Record<string, any> = {
      title: updates.title,
      description: updates.description,
      is_read: updates.is_read ?? false,
      created_at: updates.created_at ?? new Date().toISOString(),
    };
    await supabaseAdmin
      .from('notifications')
      .update(safeUpdates)
      .eq('id', id);
  }
}

/**
 * GET /notifications/friend-requests
 */
export async function findFriendRequests(userId: string): Promise<NotificationRow[]> {
  const { data, error } = await supabaseAdmin
    .from('notifications')
    .select(NOTIFICATION_COLUMNS)
    .eq('user_id', userId)
    .eq('type', 'friend_request')
    .order('created_at', { ascending: false });

  if (error) {
    if (isMissingColumnError(error)) {
      const fallback = await supabaseAdmin
        .from('notifications')
        .select(NOTIFICATION_COLUMNS_FALLBACK)
        .eq('user_id', userId)
        .eq('type', 'friend_request')
        .order('created_at', { ascending: false });
      if (fallback.error) throw fallback.error;
      return (fallback.data as NotificationRow[]) ?? [];
    }
    throw error;
  }
  return (data as NotificationRow[]) ?? [];
}

/**
 * PATCH /notifications/:id/read
 */
export async function markOneRead(id: string, userId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('notifications')
    .update({ is_read: true })
    .eq('id', id)
    .eq('user_id', userId);

  if (error) throw error;
}

/**
 * Mark notifications read by conversation or target entity
 */
export async function markTargetRead(targetId: string, userId: string): Promise<void> {
  // 1. Update directly by target_id if present
  try {
    await supabaseAdmin
      .from('notifications')
      .update({ is_read: true })
      .eq('user_id', userId)
      .eq('target_id', targetId);
  } catch {
    // ignore missing column
  }

  // 2. Fetch unread notifications and update those with description containing targetId
  try {
    const { data: unread } = await supabaseAdmin
      .from('notifications')
      .select('id, description')
      .eq('user_id', userId)
      .eq('is_read', false);

    const matchingIds = (unread || [])
      .filter((n) => n.description?.includes(targetId))
      .map((n) => n.id);

    if (matchingIds.length > 0) {
      await supabaseAdmin
        .from('notifications')
        .update({ is_read: true })
        .in('id', matchingIds);
    }
  } catch (err) {
    console.warn('[markTargetRead] Error marking target notifications read:', err);
  }
}

/**
 * PATCH /notifications/read-all
 */
export async function markAllRead(userId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('notifications')
    .update({ is_read: true })
    .eq('user_id', userId)
    .eq('is_read', false);

  if (error) throw error;
}

/**
 * DELETE /notifications
 * Deletes all notifications for a user.
 */
export async function deleteAll(userId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('notifications')
    .delete()
    .eq('user_id', userId);

  if (error) throw error;
}

/**
 * Delete friend_request notification when confirmed or rejected
 */
export async function deleteFriendRequestNotification(userId: string, fromUserId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('notifications')
    .delete()
    .eq('user_id', userId)
    .eq('from_user_id', fromUserId)
    .in('type', ['friend_request', 'connection_request']);

  if (error) throw error;
}

/**
 * Checks if a user has an active/pending friend_request notification from another user.
 */
export async function hasPendingFriendRequest(userId: string, fromUserId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('notifications')
    .select('id')
    .eq('user_id', userId)
    .eq('from_user_id', fromUserId)
    .in('type', ['friend_request', 'connection_request'])
    .limit(1);

  if (error) throw error;
  return (data?.length ?? 0) > 0;
}


