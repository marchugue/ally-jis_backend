import { supabaseAdmin } from '../../config/supabase';
import type { NotificationRow } from '../types/notification.types';

const NOTIFICATION_COLUMNS = 'id, user_id, type, title, description, is_read, from_user_id, created_at, from_user:profiles!from_user_id(id, avatar_url, full_name, username)';

/**
 * GET /notifications?limit=20
 */
export async function findByUser(userId: string, limit: number): Promise<NotificationRow[]> {
  const { data, error } = await supabaseAdmin
    .from('notifications')
    .select(NOTIFICATION_COLUMNS)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data as NotificationRow[]) ?? [];
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

  if (error) throw error;
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
