// src/app/models/follow.model.ts

import { supabaseAdmin } from '../../config/supabase';
import type { FollowListItem } from '../types/follow.types';

const FOLLOW_PROFILE_COLUMNS = 'id, username, full_name, avatar_url, course';

/** Inserts a follow row. Safe to call if it already exists — upsert with
 * a no-op update rather than throwing on the unique (PK) violation. */
export async function follow(followerId: string, followedId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('follows')
    .upsert({ follower_id: followerId, followed_id: followedId }, { onConflict: 'follower_id,followed_id', ignoreDuplicates: true });
  if (error) throw error;
}

export async function unfollow(followerId: string, followedId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('follows')
    .delete()
    .eq('follower_id', followerId)
    .eq('followed_id', followedId);
  if (error) throw error;
}

/** Both directions in one round trip — cheaper than two separate queries
 * for the common "show me the relationship between these two" case. */
export async function getStatus(userId: string, targetId: string): Promise<{ isFollowing: boolean; isFollowedBy: boolean }> {
  const { data, error } = await supabaseAdmin
    .from('follows')
    .select('follower_id, followed_id')
    .or(`and(follower_id.eq.${userId},followed_id.eq.${targetId}),and(follower_id.eq.${targetId},followed_id.eq.${userId})`);
  if (error) throw error;

  const rows = data ?? [];
  return {
    isFollowing: rows.some((r) => r.follower_id === userId && r.followed_id === targetId),
    isFollowedBy: rows.some((r) => r.follower_id === targetId && r.followed_id === userId),
  };
}

export async function getCounts(userId: string): Promise<{ followersCount: number; followingCount: number }> {
  const [followers, following] = await Promise.all([
    supabaseAdmin.from('follows').select('follower_id', { count: 'exact', head: true }).eq('followed_id', userId),
    supabaseAdmin.from('follows').select('followed_id', { count: 'exact', head: true }).eq('follower_id', userId),
  ]);
  if (followers.error) throw followers.error;
  if (following.error) throw following.error;
  return { followersCount: followers.count ?? 0, followingCount: following.count ?? 0 };
}

function mapListItem(row: any, followedAt: string): FollowListItem {
  return {
    id: row.id,
    username: row.username ?? null,
    fullName: row.full_name ?? null,
    avatarUrl: row.avatar_url ?? null,
    course: row.course ?? null,
    followedAt,
  };
}

/** Simple offset pagination (cursor is a stringified offset) — this list
 * isn't expected to reach a size where keyset pagination's extra
 * complexity pays for itself. */
export async function listFollowers(userId: string, limit: number, offset: number): Promise<FollowListItem[]> {
  const { data, error } = await supabaseAdmin
    .from('follows')
    .select(`created_at, follower:profiles!follows_follower_id_fkey(${FOLLOW_PROFILE_COLUMNS})`)
    .eq('followed_id', userId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) throw error;
  return (data ?? [])
    .filter((row: any) => row.follower)
    .map((row: any) => mapListItem(row.follower, row.created_at));
}

export async function listFollowing(userId: string, limit: number, offset: number): Promise<FollowListItem[]> {
  const { data, error } = await supabaseAdmin
    .from('follows')
    .select(`created_at, followed:profiles!follows_followed_id_fkey(${FOLLOW_PROFILE_COLUMNS})`)
    .eq('follower_id', userId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) throw error;
  return (data ?? [])
    .filter((row: any) => row.followed)
    .map((row: any) => mapListItem(row.followed, row.created_at));
}

/** Raw id sets — used for mutual-followers/following computation, where
 * only membership matters, not the profile projection. */
export async function getFollowerIds(userId: string): Promise<Set<string>> {
  const { data, error } = await supabaseAdmin.from('follows').select('follower_id').eq('followed_id', userId);
  if (error) throw error;
  return new Set((data ?? []).map((r) => r.follower_id as string));
}

export async function getFollowingIds(userId: string): Promise<Set<string>> {
  const { data, error } = await supabaseAdmin.from('follows').select('followed_id').eq('follower_id', userId);
  if (error) throw error;
  return new Set((data ?? []).map((r) => r.followed_id as string));
}
