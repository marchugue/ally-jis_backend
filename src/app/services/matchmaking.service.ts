// src/services/matchmaking.service.ts
//
// SERVICE LAYER
// -------------
// Owns the matchmaking state machine. Calls the model, never touches
// Supabase directly, never touches req/res (mirrors auth.service.ts).
// Also owns socket emits — the controller stays thin and the model stays
// pure data access.

import type { MatchIdentityView, MatchRow, MatchmakingStatus, QueueRow } from '../types/matchmaking.types';
import { DAILY_MATCH_LIMIT } from '../types/matchmaking.types';
import * as matchModel from '../models/matchmaking.model';
import * as interactionModel from '../models/interaction.model';
import * as conversationModel from '../models/conversation.model';
import { upgradeConversationToAllied } from '../models/conversation.model';
import { clearAllTimersForMatch, clearTimer, scheduleTimer } from '../utils/matchTimers';
import { HttpError } from '../types/auth.types';
import { pickTwoDistinctIdentities } from '../constants/anonymousIdentity';
import { MIN_MESSAGES_PER_VALID_DAY, stageForStreak, stageName } from '../constants/progression';
import { emitToUser } from './realtime.service';
import { phtDateStr } from '../utils/pht';

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
  const [activeMatches, todayCount] = await Promise.all([
    matchModel.getActiveMatchesForUser(userId),
    matchModel.countTodayMatchesForUser(userId),
  ]);

  if (todayCount >= DAILY_MATCH_LIMIT) {
    throw new HttpError(
      `You've reached the daily limit of ${DAILY_MATCH_LIMIT} anonymous matches. Try again tomorrow!`,
      429,
    );
  }

  // If the user already has a pending match, clicking "Find a Match" again
  // is a no-op — return or create a queue entry so the frontend overlay opens
  // and shows the pending confirmation. We no longer throw 409 here because
  // the old redirect-to-conversation flow is gone; the overlay handles both
  // 'searching' and 'pending' phases and must receive a successful response.
  const hasPending = activeMatches.some((m) => m.status === 'pending');
  if (hasPending) {
    const existing = await matchModel.getQueueEntry(userId);
    if (existing) return existing;
    return {
      id: '',
      user_id: userId,
      status: 'searching',
      joined_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  }

  const entry = await matchModel.joinQueue(userId);
  await tryMatch(userId);
  return entry;
}

export async function leaveQueue(userId: string): Promise<void> {
  await matchModel.leaveQueue(userId);
}

export async function getStatus(
  userId: string,
): Promise<MatchmakingStatus & { identity: MatchIdentityView | null }> {
  const [queueEntry, activeMatches, dailyMatchCount] = await Promise.all([
    matchModel.getQueueEntry(userId),
    matchModel.getActiveMatchesForUser(userId),
    matchModel.countTodayMatchesForUser(userId),
  ]);

  const primaryMatch =
    activeMatches.find((m) => m.status === 'pending') ??
    activeMatches.find((m) => m.status === 'chatting') ??
    activeMatches.find((m) => m.status === 'confirmed') ??
    null;

  const identity = primaryMatch
    ? await matchModel.getIdentityView(primaryMatch.id, userId)
    : null;

  return {
    queueEntry,
    activeMatch: primaryMatch,
    activeMatches,
    dailyMatchCount,
    identity,
  };
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

  // Unconditionally purge matchmaking_queue rows for both users now that a match is reserved
  await Promise.all([
    matchModel.purgeQueueEntry(requesterId).catch(() => {}),
    matchModel.purgeQueueEntry(candidate_id).catch(() => {}),
  ]);

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

    // Make sure matchmaking_queue is cleanly purged for both users
    await Promise.all([
      matchModel.purgeQueueEntry(match.user_a_id).catch(() => {}),
      matchModel.purgeQueueEntry(match.user_b_id).catch(() => {}),
    ]);

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
  const currentMatch = await matchModel.getMatchByConversationId(conversationId);
  if (!currentMatch) return;

  // If already confirmed, ensure timer is cleared and update progression
  if (currentMatch.status === 'confirmed') {
    clearTimer(currentMatch.id, 'chat');
    const isUserA = currentMatch.user_a_id === senderId;
    const today = phtDateStr();
    await matchModel.incrementDailyActivity(currentMatch.id, isUserA, today).catch(() => {});
    await recomputeProgression(currentMatch.id).catch(() => {});
    return;
  }

  // Check if both members have now sent at least 1 message in this conversation
  const bothMessaged = await matchModel.hasBothMembersMessaged(
    conversationId,
    currentMatch.user_a_id,
    currentMatch.user_b_id,
  );

  let match: MatchRow | null = null;
  if (bothMessaged) {
    // Both participants have chatted! Confirm the match permanently
    clearTimer(currentMatch.id, 'chat');
    match = await matchModel.confirmMatch(currentMatch.id);
    const payload = { matchId: currentMatch.id, conversationId };
    emitToUser(currentMatch.user_a_id, 'matchmaking:match_confirmed', payload);
    emitToUser(currentMatch.user_b_id, 'matchmaking:match_confirmed', payload);
  } else {
    // Only one participant has messaged so far — push the expiry deadline out 5 minutes in BOTH DB and timer
    const newExpiresAt = new Date(Date.now() + CHAT_FIRST_MESSAGE_TIMEOUT_MS).toISOString();
    await matchModel.updateChatExpiry(currentMatch.id, newExpiresAt).catch(() => {});

    scheduleTimer(currentMatch.id, 'chat', CHAT_FIRST_MESSAGE_TIMEOUT_MS, () => {
      void handleChatTimeout(currentMatch.id);
    });

    match = await matchModel.recordMatchMessage(conversationId, senderId).catch(() => null);
    if (match) {
      const payload = { matchId: match.id, streak: match.streak_count };
      emitToUser(match.user_a_id, 'matchmaking:streak_update', payload);
      emitToUser(match.user_b_id, 'matchmaking:streak_update', payload);
    }
  }

  // Day-based streak/stage progression
  const targetMatch = match ?? currentMatch;
  if (targetMatch.status === 'chatting' || targetMatch.status === 'confirmed') {
    const isUserA = targetMatch.user_a_id === senderId;
    const today = phtDateStr();
    await matchModel.incrementDailyActivity(targetMatch.id, isUserA, today).catch(() => {});
    await recomputeProgression(targetMatch.id).catch(() => {});
  }
}

/**
 * Recomputes day_streak/current_stage from match_daily_activity and
 * persists + broadcasts only if something actually changed. Safe to
 * call as often as needed (e.g. also from a status poll) — it's a pure
 * read-then-maybe-write, no side effects if nothing changed.
 *
 * Streak counts consecutive PHT calendar days (UTC+8, Asia/Manila).
 * A day only counts if BOTH sides hit MIN_MESSAGES_PER_VALID_DAY.
 * Today never *breaks* a streak just for being incomplete — it simply
 * doesn't count yet until it's valid.
 */
export async function recomputeProgression(matchId: string): Promise<{ stage: number; dayStreak: number }> {
  const [rows, match] = await Promise.all([matchModel.getDailyActivity(matchId), matchModel.getMatchById(matchId)]);
  if (!match) return { stage: 0, dayStreak: 0 };

  const validDates = new Set(
    rows
      .filter((r) => r.user_a_message_count >= MIN_MESSAGES_PER_VALID_DAY && r.user_b_message_count >= MIN_MESSAGES_PER_VALID_DAY)
      .map((r) => r.activity_date),
  );

  const today = phtDateStr();

  // Walk backwards from today PHT (or yesterday if today isn't valid yet).
  let cursor = validDates.has(today) ? today : new Date(new Date().getTime() + 8 * 3600_000 - 86_400_000).toISOString().slice(0, 10);
  let dayStreak = 0;
  while (validDates.has(cursor)) {
    dayStreak += 1;
    const prev = new Date(`${cursor}T00:00:00+08:00`);
    prev.setDate(prev.getDate() - 1);
    cursor = prev.toISOString().slice(0, 10);
  }

  const stage = stageForStreak(dayStreak);
  const changed = stage !== match.current_stage || dayStreak !== match.day_streak;

  if (changed) {
    await matchModel.updateProgression(matchId, stage, dayStreak);
    const payload = { matchId, stage, dayStreak, stageName: stageName(stage) };
    emitToUser(match.user_a_id, 'matchmaking:stage_updated', payload);
    emitToUser(match.user_b_id, 'matchmaking:stage_updated', payload);
  }

  // Stage 4: Automatically become Allies when reaching Stage 4
  if (stage >= 4 && !match.revealed_at) {
    // Upgrade the conversation type to 'allied' — this is the DB-level
    // signal that real profile data may now be shown to both members.
    if (match.conversation_id) {
      await upgradeConversationToAllied(match.conversation_id).catch((err) =>
        console.error('[recomputeProgression] upgradeConversationToAllied failed:', err)
      );
    }

    await matchModel.markRevealedIfMatched(match.user_a_id, match.user_b_id);
    await interactionModel.createAllyRelationship(match.user_a_id, match.user_b_id);

    const unlockPayload = { matchId, conversationId: match.conversation_id, stage: 4 };
    emitToUser(match.user_a_id, 'matchmaking:allies_unlocked', unlockPayload);
    emitToUser(match.user_b_id, 'matchmaking:allies_unlocked', unlockPayload);

    await Promise.all([
      interactionModel.createNotification({
        userId: match.user_a_id,
        type: 'accepted',
        title: '🎉 Campus Allies Unlocked!',
        description: 'You and your match completed the Ally Roadmap! Your identities have been revealed and you are now official Allies.',
        fromUserId: match.user_b_id,
        targetId: match.conversation_id,
      }),
      interactionModel.createNotification({
        userId: match.user_b_id,
        type: 'accepted',
        title: '🎉 Campus Allies Unlocked!',
        description: 'You and your match completed the Ally Roadmap! Your identities have been revealed and you are now official Allies.',
        fromUserId: match.user_a_id,
        targetId: match.conversation_id,
      }),
    ]).catch((err) => console.error('Error dispatching ally unlocked notification:', err));
  }

  return { stage, dayStreak };
}

// ---------------------------------------------------------------------------
// Reveal linkage & Direct Match Requests
// ---------------------------------------------------------------------------

/**
 * Initiates an anonymous match between two users from a connect/match request.
 * SECURITY: Always creates a FRESH anonymous conversation — never reuses any
 * existing conversation, even if the users are already allies. This prevents
 * history leaks and ensures every new relationship starts at Stage 1.
 */
export async function requestDirectMatch(
  requesterId: string,
  targetUserId: string,
): Promise<{ conversationId: string; matchId: string | null; isAllies: boolean }> {
  if (requesterId === targetUserId) {
    throw new HttpError('Cannot connect with yourself', 400);
  }

  // Check if an active UNREVEALED match already exists between them.
  // If so, resume that existing anonymous conversation (same match session).
  // We never resume REVEALED/ALLIED conversations — those are a different state.
  const existingMatch = await matchModel.findActiveMatchBetweenUsers(requesterId, targetUserId);
  if (existingMatch && !existingMatch.revealed_at) {
    const convId =
      existingMatch.conversation_id ||
      (await conversationModel.findActiveAnonymousConversationId(requesterId, targetUserId)) ||
      (() => { throw new HttpError('Match exists but conversation is missing', 500); })();
    return {
      conversationId: convId!,
      matchId: existingMatch.id,
      isAllies: false,
    };
  }

  // Whether they're strangers or existing allies, always start a FRESH
  // anonymous conversation. No history carry-over, no identity shortcuts.
  const isAllies = await interactionModel.isAllies(requesterId, targetUserId);

  // Create brand-new anonymous conversation
  const conversationId = await conversationModel.createConversation('anonymous');
  await conversationModel.addMembers(conversationId, [requesterId, targetUserId]);

  // Assign distinct anonymous identities
  const [identityA, identityB] = pickTwoDistinctIdentities();

  // Create direct match at Stage 1
  const match = await matchModel.createDirectMatch({
    userAId: requesterId,
    userBId: targetUserId,
    conversationId,
    userAAlias: identityA.alias,
    userAAvatar: identityA.avatar,
    userBAlias: identityB.alias,
    userBAvatar: identityB.avatar,
  });

  // Notify target user (anonymous notification — no real identity in payload)
  await interactionModel
    .createNotification({
      userId: targetUserId,
      type: 'friend_request',
      title: 'New Anonymous Match!',
      description: 'An anonymous peer wants to connect with you! Say hello in anonymous chat.',
      fromUserId: requesterId,
      targetId: conversationId,
    })
    .catch((err) => console.error('Error creating match notification:', err));

  return { conversationId, matchId: match.id, isAllies };
}

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
  let targetMatchId = matchId;
  const matchDirect = await matchModel.getMatchById(matchId);
  if (!matchDirect) {
    const matchByConv = await matchModel.getMatchByConversationId(matchId);
    if (matchByConv) {
      targetMatchId = matchByConv.id;
    }
  }
  clearAllTimersForMatch(targetMatchId);
  const match = await matchModel.endMatch(targetMatchId, userId);
  const otherUserId = match.user_a_id === userId ? match.user_b_id : match.user_a_id;
  emitToUser(otherUserId, 'matchmaking:match_ended', { matchId: targetMatchId });
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