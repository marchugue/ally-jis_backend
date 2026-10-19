// src/app/models/game.model.ts
//
// MODEL LAYER — Supabase queries for 2-player game sessions, results and the
// leaderboard. Tables are created by supabase/migrations/028_game_multiplayer.sql.

import { supabaseAdmin } from '../../config/supabase';

export type GameSessionStatus =
  | 'invited'
  | 'active'
  | 'finished'
  | 'declined'
  | 'cancelled'
  | 'expired'
  | 'abandoned';

export interface GameSessionRow {
  id: string;
  game_id: 'ttt' | 'clue' | 'merge';
  host_id: string;
  guest_id: string;
  conversation_id: string | null;
  match_id: string | null;
  invite_message_id: string | null;
  status: GameSessionStatus;
  state: any;
  turn_user_id: string | null;
  host_score: number;
  guest_score: number;
  winner_id: string | null;
  is_draw: boolean;
  end_reason: string | null;
  rematch_of: string | null;
  invite_expires_at: string | null;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface GameResultRow {
  session_id: string;
  user_id: string;
  opponent_id: string | null;
  game_id: 'ttt' | 'clue' | 'merge';
  result: 'win' | 'loss' | 'draw';
  points: number;
  score: number;
  duration_sec: number;
}

export interface LeaderboardRow {
  user_id: string;
  game_id: string;
  wins: number;
  losses: number;
  draws: number;
  games_played: number;
  points: number;
  best_score: number;
  last_played_at: string | null;
}

export async function insertSession(input: {
  gameId: string;
  hostId: string;
  guestId: string;
  conversationId: string | null;
  matchId: string | null;
  status?: GameSessionStatus;
  state?: any;
  turnUserId?: string | null;
  inviteExpiresAt?: string | null;
  startedAt?: string | null;
  rematchOf?: string | null;
}): Promise<GameSessionRow> {
  const { data, error } = await supabaseAdmin
    .from('game_sessions')
    .insert({
      game_id: input.gameId,
      host_id: input.hostId,
      guest_id: input.guestId,
      conversation_id: input.conversationId,
      match_id: input.matchId,
      status: input.status ?? 'invited',
      state: input.state ?? {},
      turn_user_id: input.turnUserId ?? null,
      invite_expires_at: input.inviteExpiresAt ?? null,
      started_at: input.startedAt ?? null,
      rematch_of: input.rematchOf ?? null,
    })
    .select('*')
    .single();
  if (error) throw error;
  return data as GameSessionRow;
}

export async function findSessionById(id: string): Promise<GameSessionRow | null> {
  const { data, error } = await supabaseAdmin.from('game_sessions').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return (data as GameSessionRow | null) ?? null;
}

/**
 * Optimistic-concurrency update: only applies when the row's `updated_at` is
 * still what the caller read. Returns null when someone else got there first.
 */
export async function updateSession(
  id: string,
  expectedUpdatedAt: string,
  patch: Partial<Record<string, unknown>>,
): Promise<GameSessionRow | null> {
  const { data, error } = await supabaseAdmin
    .from('game_sessions')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('updated_at', expectedUpdatedAt)
    .select('*')
    .maybeSingle();
  if (error) throw error;
  return (data as GameSessionRow | null) ?? null;
}

export async function setInviteMessageId(sessionId: string, messageId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('game_sessions')
    .update({ invite_message_id: messageId })
    .eq('id', sessionId);
  if (error) throw error;
}

export async function findActiveSessionForUser(userId: string): Promise<GameSessionRow | null> {
  const { data, error } = await supabaseAdmin
    .from('game_sessions')
    .select('*')
    .eq('status', 'active')
    .or(`host_id.eq.${userId},guest_id.eq.${userId}`)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as GameSessionRow | null) ?? null;
}

/** Open (pending, not yet expired) invites addressed to this user. */
export async function listPendingInvitesForUser(userId: string): Promise<GameSessionRow[]> {
  const { data, error } = await supabaseAdmin
    .from('game_sessions')
    .select('*')
    .eq('status', 'invited')
    .eq('guest_id', userId)
    .gt('invite_expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(10);
  if (error) throw error;
  return (data ?? []) as GameSessionRow[];
}

/** Pending invites sent by `hostId` to `guestId` (used to supersede old invites). */
export async function listOpenInvitesBetween(hostId: string, guestId: string): Promise<GameSessionRow[]> {
  const { data, error } = await supabaseAdmin
    .from('game_sessions')
    .select('*')
    .eq('status', 'invited')
    .eq('host_id', hostId)
    .eq('guest_id', guestId);
  if (error) throw error;
  return (data ?? []) as GameSessionRow[];
}

export async function listActiveSessions(): Promise<GameSessionRow[]> {
  const { data, error } = await supabaseAdmin.from('game_sessions').select('*').eq('status', 'active');
  if (error) throw error;
  return (data ?? []) as GameSessionRow[];
}

export async function listStaleInvites(nowIso: string): Promise<GameSessionRow[]> {
  const { data, error } = await supabaseAdmin
    .from('game_sessions')
    .select('*')
    .eq('status', 'invited')
    .lt('invite_expires_at', nowIso)
    .limit(100);
  if (error) throw error;
  return (data ?? []) as GameSessionRow[];
}

/** Maps invite chat-message ids → their session (for rendering chat invite cards). */
export async function findSessionsByInviteMessageIds(messageIds: string[]): Promise<GameSessionRow[]> {
  if (messageIds.length === 0) return [];
  const { data, error } = await supabaseAdmin
    .from('game_sessions')
    .select('*')
    .in('invite_message_id', messageIds);
  if (error) throw error;
  return (data ?? []) as GameSessionRow[];
}

export async function insertResults(rows: GameResultRow[]): Promise<void> {
  if (rows.length === 0) return;
  // upsert on (session_id, user_id) so a retried finish can never double-count
  const { error } = await supabaseAdmin
    .from('game_results')
    .upsert(rows, { onConflict: 'session_id,user_id', ignoreDuplicates: true });
  if (error) throw error;
}

/**
 * Total seconds two players actually spent in finished/abandoned duels under
 * the same match since `sinceIso`. Each duel is capped so idling can't farm
 * the 5-minute `play_game` threshold.
 */
export async function sumPlayedSecondsForMatch(
  matchId: string,
  sinceIso: string,
  perGameCapSec: number,
): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from('game_sessions')
    .select('started_at, ended_at')
    .eq('match_id', matchId)
    .in('status', ['finished', 'abandoned'])
    .not('started_at', 'is', null)
    .not('ended_at', 'is', null)
    .gte('ended_at', sinceIso);
  if (error) throw error;
  return (data ?? []).reduce((sum, row: any) => {
    const seconds = Math.max(0, (Date.parse(row.ended_at) - Date.parse(row.started_at)) / 1000);
    return sum + Math.min(seconds, perGameCapSec);
  }, 0);
}

// ── Leaderboard ──────────────────────────────────────────────────────────────

export async function listLeaderboard(
  gameId: string,
  opts: { userIds?: string[]; limit: number },
): Promise<LeaderboardRow[]> {
  let query = supabaseAdmin
    .from('game_leaderboard')
    .select('*')
    .eq('game_id', gameId)
    .order('points', { ascending: false })
    .order('wins', { ascending: false })
    .order('best_score', { ascending: false })
    .order('last_played_at', { ascending: true })
    .limit(opts.limit);

  if (opts.userIds) {
    if (opts.userIds.length === 0) return [];
    query = query.in('user_id', opts.userIds);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as LeaderboardRow[];
}

export async function getLeaderboardRow(userId: string, gameId: string): Promise<LeaderboardRow | null> {
  const { data, error } = await supabaseAdmin
    .from('game_leaderboard')
    .select('*')
    .eq('game_id', gameId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return (data as LeaderboardRow | null) ?? null;
}

/** How many players rank strictly ahead of `row` (global scope). */
export async function countPlayersAhead(row: LeaderboardRow): Promise<number> {
  const base = () =>
    supabaseAdmin.from('game_leaderboard').select('user_id', { count: 'exact', head: true }).eq('game_id', row.game_id);

  const [higherPoints, samePointsMoreWins, samePointsSameWinsHigherBest] = await Promise.all([
    base().gt('points', row.points),
    base().eq('points', row.points).gt('wins', row.wins),
    base().eq('points', row.points).eq('wins', row.wins).gt('best_score', row.best_score),
  ]);

  for (const res of [higherPoints, samePointsMoreWins, samePointsSameWinsHigherBest]) {
    if (res.error) throw res.error;
  }
  return (higherPoints.count ?? 0) + (samePointsMoreWins.count ?? 0) + (samePointsSameWinsHigherBest.count ?? 0);
}

export async function listStatsForUser(userId: string): Promise<LeaderboardRow[]> {
  const { data, error } = await supabaseAdmin.from('game_leaderboard').select('*').eq('user_id', userId);
  if (error) throw error;
  return (data ?? []) as LeaderboardRow[];
}

export async function findProfilesByIds(
  ids: string[],
): Promise<Array<{ id: string; full_name: string | null; username: string | null; avatar_url: string | null }>> {
  if (ids.length === 0) return [];
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('id, full_name, username, avatar_url')
    .in('id', ids);
  if (error) throw error;
  return (data ?? []) as any[];
}

// ── Chat invite card ─────────────────────────────────────────────────────────

/** Shape attached to chat messages as `message.game_invite` so clients can render an Accept/Play card. */
export interface GameInviteInfo {
  sessionId: string;
  gameId: 'ttt' | 'clue' | 'merge';
  /** 'invited' flips to 'expired' automatically once invite_expires_at has passed. */
  status: GameSessionStatus;
  hostId: string;
  guestId: string;
  expiresAt: string | null;
}

export function effectiveStatus(row: Pick<GameSessionRow, 'status' | 'invite_expires_at'>): GameSessionStatus {
  if (row.status === 'invited' && row.invite_expires_at && Date.parse(row.invite_expires_at) <= Date.now()) {
    return 'expired';
  }
  return row.status;
}

export function toInviteInfo(row: GameSessionRow): GameInviteInfo {
  return {
    sessionId: row.id,
    gameId: row.game_id,
    status: effectiveStatus(row),
    hostId: row.host_id,
    guestId: row.guest_id,
    expiresAt: row.invite_expires_at,
  };
}
