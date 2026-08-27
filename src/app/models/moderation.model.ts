// src/models/moderation.model.ts
import { supabaseAdmin } from '../../config/supabase';
import type { BlockRow, ReportRow, CreateReportParams } from '../types/moderation.types';

/**
 * Upserts a block row. onConflict on (blocker_id, blocked_id) so
 * re-blocking an already blocked user refreshes the timestamp instead of
 * throwing a duplicate-key error.
 */
export async function createBlock(blockerId: string, blockedId: string): Promise<BlockRow> {
  const { data, error } = await supabaseAdmin
    .from('blocks')
    .upsert(
      { blocker_id: blockerId, blocked_id: blockedId, created_at: new Date().toISOString() },
      { onConflict: 'blocker_id,blocked_id' },
    )
    .select('blocker_id, blocked_id, created_at')
    .single();

  if (error) throw error;
  return data as BlockRow;
}

export async function isBlocked(userId: string, otherUserId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('blocks')
    .select('blocker_id')
    .or(
      `and(blocker_id.eq.${userId},blocked_id.eq.${otherUserId}),and(blocker_id.eq.${otherUserId},blocked_id.eq.${userId})`,
    )
    .limit(1);

  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

/**
 * Removes any pending/accepted interaction rows between the two users in
 * both directions, so a blocked contact also disappears from connections.
 *
 * Note: no transaction client here (Supabase JS has no cross-call
 * transaction support like PoolClient did). If createBlock +
 * deleteInteractionsBetween need to be atomic, call them from the service
 * layer back-to-back, or wrap both in a Postgres RPC function.
 */
export async function deleteInteractionsBetween(userId: string, otherUserId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('user_interactions')
    .delete()
    .or(
      `and(user_id.eq.${userId},target_user_id.eq.${otherUserId}),and(user_id.eq.${otherUserId},target_user_id.eq.${userId})`,
    );

  if (error) throw error;
}

export async function createReport({
  reporterId,
  reportedUserId,
  violationId,
  conversationId,
}: CreateReportParams): Promise<ReportRow> {
  const { data, error } = await supabaseAdmin
    .from('reports')
    .insert({
      reporter_id: reporterId,
      reported_user_id: reportedUserId,
      violation_id: violationId,
      conversation_id: conversationId ?? null,
    })
    .select('id, created_at')
    .single();

  if (error) throw error;
  return data as ReportRow;
}

/**
 * Returns the ids of every user blocked in either direction with `userId`
 * — people they've blocked, and people who've blocked them. Used to filter
 * conversations and gate message-sending symmetrically for both sides.
 */
export async function findBlockedUserIds(userId: string): Promise<string[]> {
  const { data, error } = await supabaseAdmin
    .from('blocks')
    .select('blocker_id, blocked_id')
    .or(`blocker_id.eq.${userId},blocked_id.eq.${userId}`);

  if (error) throw error;
  return (data ?? []).map((row) =>
    row.blocker_id === userId ? (row.blocked_id as string) : (row.blocker_id as string),
  );
}

// src/models/moderation.model.ts (additions)

export interface BlockDirections {
  blockedByMe: string[];
  blockedMe: string[];
}

/**
 * Removes a block row. No-op (not an error) if it doesn't exist.
 */
export async function deleteBlock(blockerId: string, blockedId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('blocks')
    .delete()
    .eq('blocker_id', blockerId)
    .eq('blocked_id', blockedId);

  if (error) throw error;
}

/**
 * Returns both directions of blocking for a user in one query: who they've
 * blocked, and who has blocked them. Used to compute per-conversation
 * blockStatus without hiding the conversation.
 */
export async function findBlockDirectionsForUser(userId: string): Promise<BlockDirections> {
  const { data, error } = await supabaseAdmin
    .from('blocks')
    .select('blocker_id, blocked_id')
    .or(`blocker_id.eq.${userId},blocked_id.eq.${userId}`);

  if (error) throw error;
  const rows = data ?? [];

  return {
    blockedByMe: rows.filter((r) => r.blocker_id === userId).map((r) => r.blocked_id as string),
    blockedMe: rows.filter((r) => r.blocked_id === userId).map((r) => r.blocker_id as string),
  };
}

/**
 * Fetches everyone `userId` has blocked, with their profile info, for the
 * blocklist page. Relies on the blocks.blocked_id -> profiles.id FK.
 */
export async function findBlockedUsersWithProfiles(userId: string) {
  const { data, error } = await supabaseAdmin
    .from('blocks')
    .select('blocked_id, created_at, profiles:blocked_id (id, full_name, username, avatar_url)')
    .eq('blocker_id', userId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data ?? [];
}