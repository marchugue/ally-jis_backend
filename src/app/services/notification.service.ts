import * as notificationModel from '../models/notification.model';
import type { NotificationRow } from '../types/notification.types';

const DEFAULT_LIMIT = 20;

/**
 * GET /notifications?limit=20
 */
export async function listNotifications(userId: string, limit?: number): Promise<NotificationRow[]> {
  return notificationModel.findByUser(userId, limit ?? DEFAULT_LIMIT);
}

/**
 * GET /notifications/friend-requests
 */
export async function listFriendRequests(userId: string): Promise<NotificationRow[]> {
  return notificationModel.findFriendRequests(userId);
}

/**
 * PATCH /notifications/:id/read
 */
export async function markRead(id: string, userId: string): Promise<void> {
  await notificationModel.markOneRead(id, userId);
}

/**
 * PATCH /notifications/read-all
 */
export async function markAllRead(userId: string): Promise<void> {
  await notificationModel.markAllRead(userId);
}

/**
 * DELETE /notifications
 */
export async function clearAllNotifications(userId: string): Promise<void> {
  await notificationModel.deleteAll(userId);
}
