// src/app/services/follow.service.ts

import * as followModel from '../models/follow.model';
import { createNotification } from '../models/interaction.model';
import { HttpError } from '../types/auth.types';
import type { FollowCounts, FollowFilterOptions, FollowStatusResponse, PaginatedFollowList } from '../types/follow.types';

const DEFAULT_PAGE_SIZE = 20;

export async function followUser(userId: string, targetUserId: string): Promise<void> {
  if (userId === targetUserId) {
    throw new HttpError('You cannot follow yourself', 409);
  }

  await followModel.follow(userId, targetUserId);

  // If targetUserId had previously followed userId, userId has now followed them back.
  // Remove the new_follower notification for userId since they are now following them back.
  try {
    const notificationModel = await import('../models/notification.model');
    await notificationModel.deleteFollowerNotification(userId, targetUserId);
    const { emitToUser } = await import('./realtime.service');
    emitToUser(userId, 'notification:removed', {
      type: 'new_follower',
      fromUserId: targetUserId,
      targetId: targetUserId,
    });
  } catch (err) {
    console.warn('[followService] Could not clean up follower notification for follow-back:', err);
  }

  await createNotification({
    userId: targetUserId,
    type: 'new_follower',
    title: 'New Follower',
    description: 'Someone started following you.',
    fromUserId: userId,
    targetId: userId,
  });

  try {
    const { recordActivity } = await import('./activityLog.service');
    recordActivity({
      userId,
      bucket: 'connections',
      action: 'user:followed',
      title: 'Followed a student',
      targetType: 'profile',
      targetId: targetUserId,
    });
  } catch {}

  try {
    const { emitToUser } = await import('./realtime.service');
    emitToUser(targetUserId, 'follow:updated', {
      followerId: userId,
      targetUserId,
      isFollowing: true,
      action: 'follow',
    });
    emitToUser(userId, 'follow:updated', {
      followerId: userId,
      targetUserId,
      isFollowing: true,
      action: 'follow',
    });
  } catch {}
}

export async function unfollowUser(userId: string, targetUserId: string): Promise<void> {
  await followModel.unfollow(userId, targetUserId);

  try {
    const { recordActivity } = await import('./activityLog.service');
    recordActivity({
      userId,
      bucket: 'connections',
      action: 'user:unfollowed',
      title: 'Unfollowed a student',
      targetType: 'profile',
      targetId: targetUserId,
    });
  } catch {}

  try {
    const { emitToUser } = await import('./realtime.service');
    emitToUser(targetUserId, 'follow:updated', {
      followerId: userId,
      targetUserId,
      isFollowing: false,
      action: 'unfollow',
    });
    emitToUser(userId, 'follow:updated', {
      followerId: userId,
      targetUserId,
      isFollowing: false,
      action: 'unfollow',
    });
  } catch {}
}

export async function getFollowStatus(userId: string, targetUserId: string): Promise<FollowStatusResponse> {
  return followModel.getStatus(userId, targetUserId);
}

export async function getFollowCounts(userId: string): Promise<FollowCounts> {
  return followModel.getCounts(userId);
}

export async function listFollowers(
  userId: string,
  cursor: string | null,
  limit = DEFAULT_PAGE_SIZE,
  filters?: FollowFilterOptions
): Promise<PaginatedFollowList> {
  const offset = cursor ? Number(cursor) || 0 : 0;
  const items = await followModel.listFollowers(userId, limit + 1, offset, filters);
  const hasMore = items.length > limit;
  return { items: items.slice(0, limit), nextCursor: hasMore ? String(offset + limit) : null };
}

export async function listFollowing(
  userId: string,
  cursor: string | null,
  limit = DEFAULT_PAGE_SIZE,
  filters?: FollowFilterOptions
): Promise<PaginatedFollowList> {
  const offset = cursor ? Number(cursor) || 0 : 0;
  const items = await followModel.listFollowing(userId, limit + 1, offset, filters);
  const hasMore = items.length > limit;
  return { items: items.slice(0, limit), nextCursor: hasMore ? String(offset + limit) : null };
}
