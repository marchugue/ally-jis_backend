// src/services/matchmaking.service.ts
//
// SERVICE LAYER
// -------------
// Owns the matchmaking state machine. Calls the model, never touches
// Supabase directly, never touches req/res (mirrors auth.service.ts).
// Also owns socket emits — the controller stays thin and the model stays
// pure data access.

import * as matchModel from '../models/matchmaking.model';
import { clearAllTimersForMatch, clearTimer, scheduleTimer } from '../utils/matchTimers';
import { HttpError } from '../types/auth.types';
import { pickTwoDistinctIdentities } from '../constants/anonymousIdentity';
import { MIN_MESSAGES_PER_VALID_DAY, stageForStreak, stageName } from '../constants/progression';
import { emitToUser } from './realtime.service';
import type { MatchIdentityView, MatchRow, MatchmakingStatus, QueueRow } from '../types/matchmaking.types';

const ACCEPT_TIMEOUT_MS = 30_000;
// How long the match survives without BOTH sides having sent a message
// yet. Rescheduled on every message sent while still un-confirmed (see
// recordMatchMessage below) — this is not a one-shot "reply within X of
// matching" deadline, it's "goes quiet for X with nobody confirmed yet".
// 5 minutes rather than the original 2: two anonymous strangers reading/
// composing a first message is naturally slower than normal chat.
const CHAT_FIRST_MESSAGE_TIMEOUT_MS = 5 * 60_000;

// ---------------------------------------------------------------------------
// Queue
// ---------------------------------------------------------------------------

export async function joinQueue(userId: string): Promise<QueueRow> {
  const activeMatch = await matchModel.getActiveMatchForUser(userId);
  if (activeMatch) {
    throw new HttpError('You already have an active match', 409);
  }

  const entry = await matchModel.joinQueue(userId);

  // Try to find a candidate immediately. Fire-and-forget from the caller's
  // perspective isn't appropriate here (we want errors surfaced), so we
  // await it, but a failure to find a match is not an error — tryMatch
  // resolves quietly to "keep waiting" when nothing is found.
  await tryMatch(userId);

  return entry;
}

export async function leaveQueue(userId: string): Promise<void> {
  await matchModel.leaveQueue(userId);
}

export async function getStatus(userId: string): Promise<MatchmakingStatus & { identity: MatchIdentityView | null }> {
  const [queueEntry, activeMatch] = await Promise.all([
    matchModel.getQueueEntry(userId),
    matchModel.getActiveMatchForUser(userId),
  ]);

  const identity = activeMatch ? await matchModel.getIdentityView(activeMatch.id, userId) : null;
  return { queueEntry, activeMatch, identity };
}

/** Thin wrapper the controller uses when it needs just the identity view
 * (e.g. re-fetching after an action) without re-deriving it inline. */
export async function getMatchIdentity(matchId: string, userId: string): Promise<MatchIdentityView | null> {
  return matchModel.getIdentityView(matchId, userId);
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

async function tryMatch(requesterId: string): Promise<void> {
  const result = await matchModel.findAndReserveMatch(requesterId);
  if (!result) return; // no candidate available right now — stay in queue

  const { match_id, candidate_id, compatibility_score } = result;

  // Assign anonymous identities now, before either side sees anything —
  // there's no "requester vs candidate" order guarantee from the RPC, so
  // this doesn't try to map onto user_a/user_b itself; getIdentityView
  // does that lookup per-viewer afterward.
  const [identityA, identityB] = pickTwoDistinctIdentities();
  await matchModel.assignIdentities(match_id, identityA.alias, identityA.avatar, identityB.alias, identityB.avatar);

  scheduleTimer(match_id, 'accept', ACCEPT_TIMEOUT_MS, () => {
    void handleAcceptTimeout(match_id);
  });

  const [requesterIdentity, candidateIdentity] = await Promise.all([
    matchModel.getIdentityView(match_id, requesterId),
    matchModel.getIdentityView(match_id, candidate_id),
  ]);

  const basePayload = { matchId: match_id, compatibilityScore: compatibility_score, expiresInMs: ACCEPT_TIMEOUT_MS };
  emitToUser(requesterId, 'matchmaking:match_found', { ...basePayload, identity: requesterIdentity });
  emitToUser(candidate_id, 'matchmaking:match_found', { ...basePayload, identity: candidateIdentity });
}

export async function acceptMatch(matchId: string, userId: string): Promise<MatchRow> {
  const match = await matchModel.acceptMatch(matchId, userId);
  const otherUserId = match.user_a_id === userId ? match.user_b_id : match.user_a_id;

  if (match.status === 'chatting') {
    clearTimer(matchId, 'accept');
    scheduleTimer(matchId, 'chat', CHAT_FIRST_MESSAGE_TIMEOUT_MS, () => {
      void handleChatTimeout(matchId);
    });

    const [identityA, identityB] = await Promise.all([
      matchModel.getIdentityView(matchId, match.user_a_id),
      matchModel.getIdentityView(matchId, match.user_b_id),
    ]);
    emitToUser(match.user_a_id, 'matchmaking:room_ready', {
      matchId,
      conversationId: match.conversation_id,
      identity: identityA,
    });
    emitToUser(match.user_b_id, 'matchmaking:room_ready', {
      matchId,
      conversationId: match.conversation_id,
      identity: identityB,
    });
  } else {
    // Only one side has accepted so far — let the other side know without
    // revealing who (they'll find out when the room is ready).
    emitToUser(otherUserId, 'matchmaking:partner_accepted', { matchId });
  }

  return match;
}

export async function declineMatch(matchId: string, userId: string): Promise<void> {
  clearAllTimersForMatch(matchId);
  const match = await matchModel.declineMatch(matchId, userId);
  const otherUserId = match.user_a_id === userId ? match.user_b_id : match.user_a_id;

  emitToUser(otherUserId, 'matchmaking:partner_declined', { matchId });

  // The other side was just requeued to 'searching' by decline_match —
  // give them an immediate shot at a new candidate instead of waiting for
  // the next person to join.
  await tryMatch(otherUserId).catch((err) => console.error('tryMatch after decline failed:', err));
}

async function handleAcceptTimeout(matchId: string): Promise<void> {
  const match = await matchModel.expirePendingMatch(matchId);
  if (!match) return; // already resolved before the timer fired

  emitToUser(match.user_a_id, 'matchmaking:match_timed_out', { matchId });
  emitToUser(match.user_b_id, 'matchmaking:match_timed_out', { matchId });

  await tryMatch(match.user_a_id).catch(() => {});
  await tryMatch(match.user_b_id).catch(() => {});
}

async function handleChatTimeout(matchId: string): Promise<void> {
  const match = await matchModel.expireChatMatch(matchId);
  if (!match) return; // already confirmed before the timer fired

  emitToUser(match.user_a_id, 'matchmaking:chat_expired', { matchId });
  emitToUser(match.user_b_id, 'matchmaking:chat_expired', { matchId });

  await tryMatch(match.user_a_id).catch(() => {});
  await tryMatch(match.user_b_id).catch(() => {});
}

// ---------------------------------------------------------------------------
// Chat streak
// ---------------------------------------------------------------------------

/**
 * Call this from your existing message-send flow, right after a message
 * insert succeeds: `await matchmakingService.recordMatchMessage(conversationId, senderId)`.
 * No-ops if the conversation isn't tied to a live 'chatting' match.
 */
export async function recordMatchMessage(conversationId: string, senderId: string): Promise<void> {
  const match = await matchModel.recordMatchMessage(conversationId, senderId);
  if (!match) return;

  if (match.status === 'confirmed') {
    clearTimer(match.id, 'chat');
    const payload = { matchId: match.id, conversationId: match.conversation_id };
    emitToUser(match.user_a_id, 'matchmaking:match_confirmed', payload);
    emitToUser(match.user_b_id, 'matchmaking:match_confirmed', payload);
  } else {
    // Still waiting on a first message from the other side — someone IS
    // actively messaging though, so push the expiry deadline out another
    // full window rather than leaving the original one ticking. Without
    // this, a match could die mid-conversation just because the *other*
    // person's first reply happened to land a little later than the
    // original fixed deadline, even while messages were actively flowing.
    scheduleTimer(match.id, 'chat', CHAT_FIRST_MESSAGE_TIMEOUT_MS, () => {
      void handleChatTimeout(match.id);
    });
    const payload = { matchId: match.id, streak: match.streak_count };
    emitToUser(match.user_a_id, 'matchmaking:streak_update', payload);
    emitToUser(match.user_b_id, 'matchmaking:streak_update', payload);
  }

  // Day-based streak/stage — separate from the legacy streak_count/
  // confirmed handling above, which an existing (opaque) RPC owns and
  // this deliberately doesn't touch. Only tracked once a match is past
  // the initial handshake, since "days talked" isn't meaningful before
  // that.
  if (match.status === 'chatting' || match.status === 'confirmed') {
    const isUserA = match.user_a_id === senderId;
    const today = new Date().toISOString().slice(0, 10); // UTC calendar day — see note in recomputeProgression
    await matchModel.incrementDailyActivity(match.id, isUserA, today);
    await recomputeProgression(match.id);
  }
}

/**
 * Recomputes day_streak/current_stage from match_daily_activity and
 * persists + broadcasts only if something actually changed. Safe to
 * call as often as needed (e.g. also from a status poll) — it's a pure
 * read-then-maybe-write, no side effects if nothing changed.
 *
 * Streak counts consecutive calendar days (UTC) — not user-local days,
 * since there's no per-user timezone stored anywhere else in this
 * codebase either. A day only counts if BOTH sides hit
 * MIN_MESSAGES_PER_VALID_DAY. Today never *breaks* a streak just for
 * being incomplete — it simply doesn't count yet until it's valid.
 */
export async function recomputeProgression(matchId: string): Promise<{ stage: number; dayStreak: number }> {
  const [rows, match] = await Promise.all([matchModel.getDailyActivity(matchId), matchModel.getMatchById(matchId)]);
  if (!match) return { stage: 0, dayStreak: 0 };

  const validDates = new Set(
    rows
      .filter((r) => r.user_a_message_count >= MIN_MESSAGES_PER_VALID_DAY && r.user_b_message_count >= MIN_MESSAGES_PER_VALID_DAY)
      .map((r) => r.activity_date),
  );

  const toDateStr = (d: Date) => d.toISOString().slice(0, 10);
  const cursor = new Date();
  let dateStr = toDateStr(cursor);
  if (!validDates.has(dateStr)) {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
    dateStr = toDateStr(cursor);
  }
  let dayStreak = 0;
  while (validDates.has(dateStr)) {
    dayStreak += 1;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
    dateStr = toDateStr(cursor);
  }

  const stage = stageForStreak(dayStreak);
  const changed = stage !== match.current_stage || dayStreak !== match.day_streak;

  if (changed) {
    await matchModel.updateProgression(matchId, stage, dayStreak);
    const payload = { matchId, stage, dayStreak, stageName: stageName(stage) };
    emitToUser(match.user_a_id, 'matchmaking:stage_updated', payload);
    emitToUser(match.user_b_id, 'matchmaking:stage_updated', payload);
  }

  return { stage, dayStreak };
}

// ---------------------------------------------------------------------------
// Reveal linkage
// ---------------------------------------------------------------------------

/**
 * Called by interaction.service.ts#acceptConnection once two users
 * accept each other as friends — if they have a shared match, marks it
 * revealed so its conversation stops being treated as anonymous
 * everywhere (chat list, notifications, header). No-ops otherwise.
 */
export async function markRevealedIfMatched(userIdA: string, userIdB: string): Promise<void> {
  await matchModel.markRevealedIfMatched(userIdA, userIdB);
}

// ---------------------------------------------------------------------------
// Ending a match
// ---------------------------------------------------------------------------

export async function endMatch(matchId: string, userId: string): Promise<MatchRow> {
  clearAllTimersForMatch(matchId);
  const match = await matchModel.endMatch(matchId, userId);
  const otherUserId = match.user_a_id === userId ? match.user_b_id : match.user_a_id;
  emitToUser(otherUserId, 'matchmaking:match_ended', { matchId });
  return match;
}

// ---------------------------------------------------------------------------
// Startup safety net — see matchTimers.ts header comment.
// ---------------------------------------------------------------------------

export async function reconcileStaleMatches(): Promise<void> {
  const stalePending = await matchModel.findStalePendingMatches();
  for (const m of stalePending) {
    await handleAcceptTimeout(m.id).catch((err) => console.error('reconcile (pending) failed:', err));
  }

  const staleChatting = await matchModel.findStaleChattingMatches();
  for (const m of staleChatting) {
    await handleChatTimeout(m.id).catch((err) => console.error('reconcile (chatting) failed:', err));
  }
}