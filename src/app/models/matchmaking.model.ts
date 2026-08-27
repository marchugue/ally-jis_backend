// src/models/matchmaking.model.ts
//
// MODEL LAYER
// -----------
// Talks to Supabase directly (mirrors auth.model.ts). Business rules and
// socket emits live in matchmaking.service.ts — this file just wraps
// table access and the RPC functions defined in
// migrations/002_matchmaking.sql, and translates known Postgres error
// codes into HttpError so the service/controller layers don't need to
// know about RAISE EXCEPTION message strings.

import { supabaseAdmin } from '../../config/supabase';
import { HttpError } from '../types/auth.types';
import type { CandidateResult, MatchIdentityView, MatchRow, MatchStatus, QueueRow } from '../types/matchmaking.types';

function mapMatchRpcError(error: { message?: string }): never {
  const msg = error.message || '';
  if (msg.includes('match_not_found')) throw new HttpError('Match not found', 404);
  if (msg.includes('match_not_pending')) throw new HttpError('Match is no longer pending', 409);
  if (msg.includes('match_not_active')) throw new HttpError('Match is not active', 409);
  if (msg.includes('not_a_participant')) throw new HttpError('You are not part of this match', 403);
  if (msg.includes('match_expired')) throw new HttpError('Match acceptance window has expired', 410);
  throw new HttpError(msg || 'Matchmaking error', 500);
}

// ---------------------------------------------------------------------------
// Queue
// ---------------------------------------------------------------------------

/** Inserts a queue row for the user. Idempotent: if one already exists
 * (23505 unique violation on user_id), returns the existing row as-is
 * rather than resetting a 'reserved' entry back to 'searching'. */
export async function joinQueue(userId: string): Promise<QueueRow> {
  const { data, error } = await supabaseAdmin
    .from('matchmaking_queue')
    .insert({ user_id: userId })
    .select()
    .single();

  if (!error) return data as QueueRow;

  if ((error as { code?: string }).code === '23505') {
    const existing = await getQueueEntry(userId);
    if (existing) return existing;
  }
  throw error;
}

export async function getQueueEntry(userId: string): Promise<QueueRow | null> {
  const { data, error } = await supabaseAdmin
    .from('matchmaking_queue')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data as QueueRow | null;
}

/** Only removes the row if the user is still 'searching' — once reserved
 * or matched, leaving the queue happens implicitly via decline/end. */
export async function leaveQueue(userId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('matchmaking_queue')
    .delete()
    .eq('user_id', userId)
    .eq('status', 'searching');
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Matches
// ---------------------------------------------------------------------------

export async function getActiveMatchForUser(userId: string): Promise<MatchRow | null> {
  const { data, error } = await supabaseAdmin
    .from('matches')
    .select('*')
    .or(`user_a_id.eq.${userId},user_b_id.eq.${userId}`)
    .in('status', ['pending', 'chatting', 'confirmed'])
    .is('revealed_at', null)
    .maybeSingle();
  if (error) throw error;
  return data as MatchRow | null;
}

export async function getMatchById(matchId: string): Promise<MatchRow | null> {
  const { data, error } = await supabaseAdmin.from('matches').select('*').eq('id', matchId).maybeSingle();
  if (error) throw error;
  return data as MatchRow | null;
}

export async function findAndReserveMatch(requesterId: string): Promise<CandidateResult | null> {
  const { data, error } = await supabaseAdmin.rpc('find_and_reserve_match', { requester_id: requesterId });
  if (error) throw error;
  return (data?.[0] ?? null) as CandidateResult | null;
}

export async function acceptMatch(matchId: string, userId: string): Promise<MatchRow> {
  const { data, error } = await supabaseAdmin.rpc('accept_match', { p_match_id: matchId, p_user_id: userId });
  if (error) mapMatchRpcError(error);
  if (!data?.[0]) throw new HttpError('Match not found', 404);
  return data[0] as MatchRow;
}

export async function declineMatch(matchId: string, userId: string): Promise<MatchRow> {
  const { data, error } = await supabaseAdmin.rpc('decline_match', { p_match_id: matchId, p_user_id: userId });
  if (error) mapMatchRpcError(error);
  if (!data?.[0]) throw new HttpError('Match not found', 404);
  return data[0] as MatchRow;
}

export async function endMatch(matchId: string, userId: string): Promise<MatchRow> {
  const { data, error } = await supabaseAdmin.rpc('end_match', { p_match_id: matchId, p_user_id: userId });
  if (error) mapMatchRpcError(error);
  if (!data?.[0]) throw new HttpError('Match not found', 404);
  return data[0] as MatchRow;
}

/** Called by the server's in-memory timers, not by a user — no error
 * mapping needed since there's no HTTP request to respond to. */
export async function expirePendingMatch(matchId: string): Promise<MatchRow | null> {
  const { data, error } = await supabaseAdmin.rpc('expire_pending_match', { p_match_id: matchId });
  if (error) throw error;
  return (data?.[0] ?? null) as MatchRow | null;
}

export async function expireChatMatch(matchId: string): Promise<MatchRow | null> {
  const { data, error } = await supabaseAdmin.rpc('expire_chat_match', { p_match_id: matchId });
  if (error) throw error;
  return (data?.[0] ?? null) as MatchRow | null;
}

/** Hook this into your existing message-send flow. No-ops (returns null)
 * if the conversation isn't tied to a live 'chatting' match. */
export async function recordMatchMessage(conversationId: string, senderId: string): Promise<MatchRow | null> {
  const { data, error } = await supabaseAdmin.rpc('record_match_message', {
    p_conversation_id: conversationId,
    p_sender_id: senderId,
  });
  if (error) throw error;
  return (data?.[0] ?? null) as MatchRow | null;
}

// ---------------------------------------------------------------------------
// Anonymous identity
// ---------------------------------------------------------------------------

/**
 * Sets the alias/avatar for both sides of a match. Called once, right
 * after a match is reserved (see matchmaking.service.ts#tryMatch) — a
 * plain column update, not an RPC, so it doesn't depend on anything in
 * migrations/002_matchmaking.sql.
 */
export async function assignIdentities(
  matchId: string,
  userAAlias: string,
  userAAvatar: string,
  userBAlias: string,
  userBAvatar: string,
): Promise<void> {
  const { error } = await supabaseAdmin
    .from('matches')
    .update({
      user_a_alias: userAAlias,
      user_a_avatar: userAAvatar,
      user_b_alias: userBAlias,
      user_b_avatar: userBAvatar,
    })
    .eq('id', matchId);
  if (error) throw error;
}

/**
 * Viewer-specific alias/avatar view for a match. Deliberately a narrow,
 * direct select (not routed through an RPC) so it works regardless of
 * what migrations/002_matchmaking.sql's functions return — those were
 * written before identity columns existed and may not RETURN them.
 */
export async function getIdentityView(matchId: string, userId: string): Promise<MatchIdentityView | null> {
  const { data, error } = await supabaseAdmin
    .from('matches')
    .select('user_a_id, user_b_id, user_a_alias, user_a_avatar, user_b_alias, user_b_avatar')
    .eq('id', matchId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const isUserA = data.user_a_id === userId;
  const myAlias = isUserA ? data.user_a_alias : data.user_b_alias;
  const myAvatar = isUserA ? data.user_a_avatar : data.user_b_avatar;
  const partnerAlias = isUserA ? data.user_b_alias : data.user_a_alias;
  const partnerAvatar = isUserA ? data.user_b_avatar : data.user_a_avatar;

  // Not assigned yet (race between reservation and the identity update
  // landing) — caller should treat this the same as "not found" and
  // retry on the next status poll rather than render partial identity.
  if (!myAlias || !myAvatar || !partnerAlias || !partnerAvatar) return null;

  return { myAlias, myAvatar, partnerAlias, partnerAvatar };
}

/**
 * Looks up the active match (if any) backing a conversation. Used by
 * conversation.service.ts to detect "this message was sent inside an
 * anonymous match" without conversation.service needing to know
 * anything about matchmaking internals beyond this one lookup.
 */
export async function getMatchByConversationId(conversationId: string): Promise<MatchRow | null> {
  const { data, error } = await supabaseAdmin
    .from('matches')
    .select('*')
    .eq('conversation_id', conversationId)
    .maybeSingle();
  if (error) throw error;
  return data as MatchRow | null;
}

export interface ConversationMatchLookup {
  matchId: string;
  status: MatchStatus;
  currentStage: number;
  dayStreak: number;
  revealedAt: string | null;
  myAlias: string | null;
  myAvatar: string | null;
  partnerAlias: string | null;
  partnerAvatar: string | null;
}

/**
 * Bulk lookup used by conversation.service.ts#listMyConversations to tag
 * each conversation with its variant (regular / anonymous / anonymous
 * ended) without an extra round trip per conversation. Scoped to `userId`
 * so the alias/avatar returned is always the caller's own view — never
 * leaks which side is user_a vs user_b.
 */
export async function findMatchInfoForConversations(
  conversationIds: string[],
  userId: string,
): Promise<Map<string, ConversationMatchLookup>> {
  if (conversationIds.length === 0) return new Map();

  const { data, error } = await supabaseAdmin
    .from('matches')
    .select(
      'id, conversation_id, status, current_stage, day_streak, revealed_at, user_a_id, user_b_id, user_a_alias, user_a_avatar, user_b_alias, user_b_avatar',
    )
    .in('conversation_id', conversationIds);
  if (error) throw error;

  const map = new Map<string, ConversationMatchLookup>();
  for (const row of data ?? []) {
    if (!row.conversation_id) continue;
    const isUserA = row.user_a_id === userId;
    map.set(row.conversation_id, {
      matchId: row.id,
      status: row.status,
      currentStage: row.current_stage,
      dayStreak: row.day_streak,
      revealedAt: row.revealed_at,
      myAlias: isUserA ? row.user_a_alias : row.user_b_alias,
      myAvatar: isUserA ? row.user_a_avatar : row.user_b_avatar,
      partnerAlias: isUserA ? row.user_b_alias : row.user_a_alias,
      partnerAvatar: isUserA ? row.user_b_avatar : row.user_a_avatar,
    });
  }
  return map;
}

/** Called once a friend request between the two sides of a match is
 * accepted (see interaction.service.ts#acceptConnection) — from that
 * point on the conversation is treated as a regular conversation
 * everywhere (chat list, notifications, header), even though the match
 * row itself sticks around for historical stage/streak stats. No-ops if
 * there's no shared active/ended match between the two users, or it's
 * already revealed.
 */
export async function markRevealedIfMatched(userIdA: string, userIdB: string): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from('matches')
    .select('id')
    .or(
      `and(user_a_id.eq.${userIdA},user_b_id.eq.${userIdB}),and(user_a_id.eq.${userIdB},user_b_id.eq.${userIdA})`,
    )
    .is('revealed_at', null)
    .maybeSingle();
  if (error) throw error;
  if (!data) return;

  const { error: updateError } = await supabaseAdmin
    .from('matches')
    .update({ revealed_at: new Date().toISOString() })
    .eq('id', data.id);
  if (updateError) throw updateError;
}



export interface DailyActivityRow {
  activity_date: string;
  user_a_message_count: number;
  user_b_message_count: number;
}

/** Atomic upsert-increment via the RPC owned by 004_matchmaking_progression.sql. */
export async function incrementDailyActivity(matchId: string, isUserA: boolean, activityDate: string): Promise<void> {
  const { error } = await supabaseAdmin.rpc('increment_match_daily_activity', {
    p_match_id: matchId,
    p_activity_date: activityDate,
    p_is_user_a: isUserA,
  });
  if (error) throw error;
}

/** Capped at 60 rows — the longest a streak/stage calc ever needs to look
 * back is the 10-day Stage 4 threshold; 60 gives generous headroom for
 * gaps without an unbounded query. */
export async function getDailyActivity(matchId: string): Promise<DailyActivityRow[]> {
  const { data, error } = await supabaseAdmin
    .from('match_daily_activity')
    .select('activity_date, user_a_message_count, user_b_message_count')
    .eq('match_id', matchId)
    .order('activity_date', { ascending: false })
    .limit(60);
  if (error) throw error;
  return data ?? [];
}

export async function updateProgression(matchId: string, currentStage: number, dayStreak: number): Promise<void> {
  const { error } = await supabaseAdmin
    .from('matches')
    .update({ current_stage: currentStage, day_streak: dayStreak })
    .eq('id', matchId);
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Startup reconciliation (safety net for in-memory timers not surviving a
// restart — see matchmaking.service.ts#reconcileStaleMatches)
// ---------------------------------------------------------------------------

export async function findStalePendingMatches(): Promise<MatchRow[]> {
  const { data, error } = await supabaseAdmin
    .from('matches')
    .select('*')
    .eq('status', 'pending')
    .lt('accept_expires_at', new Date().toISOString());
  if (error) throw error;
  return (data ?? []) as MatchRow[];
}

export async function findStaleChattingMatches(): Promise<MatchRow[]> {
  const { data, error } = await supabaseAdmin
    .from('matches')
    .select('*')
    .eq('status', 'chatting')
    .lt('chat_expires_at', new Date().toISOString());
  if (error) throw error;
  return (data ?? []) as MatchRow[];
}