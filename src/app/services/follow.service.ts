// src/app/services/follow.service.ts

import * as followModel from '../models/follow.model';
import { createNotification } from '../models/interaction.model';
import { HttpError } from '../types/auth.types';
import type { FollowCounts, FollowStatusResponse, PaginatedFollowList } from '../types/follow.types';

const DEFAULT_PAGE_SIZE = 20;

export async function followUser(userId: string, targetUserId: string): Promise<void> {
  if (userId === targetUserId) {
    throw new HttpError('You cannot follow yourself', 409);
  }

  await followModel.follow(userId, targetUserId);

  await createNotification({
    userId: targetUserId,
    type: 'new_follower',
    title: 'New Follower',
    description: 'Someone started following you.',
    fromUserId: userId,
  });
}

export async function unfollowUser(userId: string, targetUserId: string): Promise<void> {
  await followModel.unfollow(userId, targetUserId);
}

export async function getFollowStatus(userId: string, targetUserId: string): Promise<FollowStatusResponse> {
  return followModel.getStatus(userId, targetUserId);
}

export async function getFollowCounts(userId: string): Promise<FollowCounts> {
  return followModel.getCounts(userId);
}

export async function listFollowers(userId: string, cursor: string | null, limit = DEFAULT_PAGE_SIZE): Promise<PaginatedFollowList> {
  const offset = cursor ? Number(cursor) || 0 : 0;
  const items = await followModel.listFollowers(userId, limit + 1, offset);
  const hasMore = items.length > limit;
  return { items: items.slice(0, limit), nextCursor: hasMore ? String(offset + limit) : null };
}

export async function listFollowing(userId: string, cursor: string | null, limit = DEFAULT_PAGE_SIZE): Promise<PaginatedFollowList> {
  const offset = cursor ? Number(cursor) || 0 : 0;
  const items = await followModel.listFollowing(userId, limit + 1, offset);
  const hasMore = items.length > limit;
  return { items: items.slice(0, limit), nextCursor: hasMore ? String(offset + limit) : null };
}
