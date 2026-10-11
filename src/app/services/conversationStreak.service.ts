// src/app/services/conversationStreak.service.ts
//
// Single authoritative DM streak service — works for ALL conversation types
// (regular DMs, anonymous matches, and confirmed/revealed matches).
//
// ── Core Algorithm & Rules (PHT = Philippine Standard Time, UTC+8) ────────────
//
//   1. Participation: Each message increments daily participation for (conversationId, senderId, todayPHT).
//      Multiple messages by the same user on the same calendar day count as ONE daily interaction.
//
//   2. Mutual Qualification: A calendar day qualifies IF AND ONLY IF both participants sent >= 1 message
//      on that calendar date in PHT. A single user alone can NEVER advance or qualify a streak day.
//
//   3. Continuity:
//      • If today qualifies: streak extends from yesterday (or starts at 1 if newly started).
//      • If today does not yet qualify, but yesterday qualified: streak is preserved at current count,
//        in 'at_risk' status until midnight PHT tonight.
//      • If neither today nor yesterday qualified: streak has lapsed/expired (count = 0).
//
//   4. Single Source of Truth: All streak calculations and updates happen here atomically on the backend.
//      Synchronizes linked match tables and broadcasts authoritative realtime events.

import { emitToUser } from './realtime.service';
import { phtDateStr, getCalendarDateOffset, phtEndOfDayUtc } from '../utils/pht';
import * as model from '../models/conversationStreak.model';
import { computeRestoreDeadline, ConversationStreakResult } from '../models/conversationStreak.model';
import { resolveStageForStreak, stageName } from '../constants/progression';
import { supabaseAdmin } from '../../config/supabase';
import { upgradeConversationToAllied } from '../models/conversation.model';
import * as interactionModel from '../models/interaction.model';
import { HttpError } from '../types/auth.types';

export { MIN_MESSAGES_PER_VALID_DAY } from '../models/conversationStreak.model';

// In-memory mutex per conversation to serialize concurrent streak updates and prevent race conditions
const conversationLocks = new Map<string, Promise<unknown>>();

export async function withConversationLock<T>(conversationId: string, fn: () => Promise<T>): Promise<T> {
  const currentLock = conversationLocks.get(conversationId) ?? Promise.resolve();
  let release: () => void;
  const nextLock = new Promise<void>((resolve) => { release = resolve; });
  conversationLocks.set(conversationId, nextLock);
  try {
    await currentLock;
    return await fn();
  } finally {
    release!();
    if (conversationLocks.get(conversationId) === nextLock) {
      conversationLocks.delete(conversationId);
    }
  }
}

// ─── Match progression sync ─────────────────────────────────────────────────

/**
 * Keeps the linked match (if any) in lock-step with the conversation streak.
 *
 * The level is derived from the LIVE streak via resolveStageForStreak():
 *   • streak grows   → level goes up (3d → Lv.2, 7d → Lv.3, 10d → Lv.4)
 *   • streak ends    → level drops back with it (e.g. Lv.3 → Lv.1, images lock)
 *   • streak restore → level comes back
 *   • Lv.4 (Campus Allies) is permanent and never drops.
 *
 * Emits 'matchmaking:stage_updated' to both members whenever the level changes
 * (including downgrades, flagged with `downgraded: true`).
 */
export async function syncMatchProgression(
  conversationId: string,
  dayStreak: number,
  streakLastActivePht: string | null,
): Promise<void> {
  try {
    const { data: match } = await supabaseAdmin
      .from('matches')
      .select('id, current_stage, day_streak, streak_last_active_pht, user_a_id, user_b_id, status')
      .eq('conversation_id', conversationId)
      .maybeSingle();

    if (!match) return;

    const prevStage: number = match.current_stage ?? 1;
    const newStage = resolveStageForStreak(prevStage, dayStreak);
    const stageChanged = newStage !== prevStage;
    const matchStreakChanged =
      match.day_streak !== dayStreak || match.streak_last_active_pht !== streakLastActivePht;

    if (!matchStreakChanged && !stageChanged) return;

    await supabaseAdmin
      .from('matches')
      .update({
        day_streak: dayStreak,
        streak_last_active_pht: streakLastActivePht,
        current_stage: newStage,
        updated_at: new Date().toISOString(),
      })
      .eq('id', match.id);

    if (!stageChanged) return;

    const stagePayload = {
      matchId: match.id,
      conversationId,
      stage: newStage,
      previousStage: prevStage,
      stageName: stageName(newStage),
      dayStreak,
      downgraded: newStage < prevStage,
    };
    emitToUser(match.user_a_id, 'matchmaking:stage_updated', stagePayload);
    emitToUser(match.user_b_id, 'matchmaking:stage_updated', stagePayload);

    if (newStage >= 4 && prevStage < 4) {
      await upgradeConversationToAllied(conversationId).catch(() => {});
      await interactionModel.createAllyRelationship(match.user_a_id, match.user_b_id).catch(() => {});
      const unlockPayload = {
        matchId: match.id,
        conversationId,
        stage: 4,
        feedUnlocked: true,
      };
      emitToUser(match.user_a_id, 'matchmaking:allies_unlocked', unlockPayload);
      emitToUser(match.user_b_id, 'matchmaking:allies_unlocked', unlockPayload);
    }
  } catch (err) {
    console.error('[StreakService] Error syncing match progression:', err);
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns the authoritative current streak information for a conversation.
 */
export async function getAuthoritativeStreak(conversationId: string): Promise<ConversationStreakResult> {
  const row = await model.getStreak(conversationId);
  return model.computeEffectiveStreak(
    row?.day_streak ?? 0,
    row?.streak_last_active_pht ?? null,
    {
      lapsedStreak: row?.lapsed_streak,
      lapsedLastActivePht: row?.lapsed_last_active_pht,
    },
  );
}

/**
 * Returns recent streak timeline events (ended / restored) for a conversation.
 */
export async function getStreakEvents(conversationId: string): Promise<model.StreakEventRow[]> {
  return model.getStreakEvents(conversationId);
}

/**
 * Called after a message is successfully inserted in any conversation.
 * Atomically increments sender participation for today and recomputes streak.
 */
export async function recordConversationMessage(
  conversationId: string,
  senderId: string,
  allMemberIds: string[],
): Promise<ConversationStreakResult> {
  const today = phtDateStr();
  // Atomic upsert into conversation_daily_activity (safe under concurrent requests)
  await model.incrementActivity(conversationId, senderId, today);

  // Serialized recompute under conversation lock
  return withConversationLock(conversationId, () =>
    recomputeConversationStreak(conversationId, allMemberIds)
  );
}

/**
 * Single authoritative streak recomputation for a conversation.
 * Safe, idempotent, and transactional with respect to state.
 */
export async function recomputeConversationStreak(
  conversationId: string,
  allMemberIds: string[],
): Promise<ConversationStreakResult> {
  const rows = await model.getDailyActivity(conversationId);
  const current = await model.getStreak(conversationId);

  // Group messages by (activity_date, user_id)
  const byDate = new Map<string, Map<string, number>>();
  for (const row of rows) {
    let userMap = byDate.get(row.activity_date);
    if (!userMap) {
      userMap = new Map<string, number>();
      byDate.set(row.activity_date, userMap);
    }
    userMap.set(row.user_id, (userMap.get(row.user_id) ?? 0) + row.message_count);
  }

  // Exactly 2 participants required for a DM streak
  const requiredParticipants = Math.min(allMemberIds.length, model.MIN_PARTICIPANTS_PER_VALID_DAY);

  // A date qualifies IF AND ONLY IF both participants sent >= 1 message on that date
  const validDates = new Set<string>();
  for (const [date, userMap] of byDate.entries()) {
    const qualifyingUsers = [...userMap.values()].filter(
      (count) => count >= model.MIN_MESSAGES_PER_VALID_DAY,
    ).length;
    if (qualifyingUsers >= requiredParticipants) {
      validDates.add(date);
    }
  }

  const today = phtDateStr();
  const yesterday = getCalendarDateOffset(today, -1);

  let dayStreak = 0;
  let streakLastActivePht: string | null = null;
  let streakActiveToday = false;
  let streakStatus: model.StreakStatus = 'inactive';
  let expiresAt: string | null = null;
  let streakRestoreDeadline: string | null = null;

  const todayQualifies = validDates.has(today);
  const yesterdayQualifies = validDates.has(yesterday);

  if (todayQualifies) {
    // Both users participated today! Streak is live and active.
    streakLastActivePht = today;
    streakActiveToday = true;
    streakStatus = 'active';
    expiresAt = phtEndOfDayUtc(getCalendarDateOffset(today, 1)); // safe until end of tomorrow PHT

    // Count consecutive qualifying days walking backward from today
    let cursor = today;
    while (validDates.has(cursor)) {
      dayStreak += 1;
      cursor = getCalendarDateOffset(cursor, -1);
    }

    // Critical data preservation: if existing stored streak was valid yesterday, extend it
    if (current && current.day_streak > 0 && current.streak_last_active_pht === yesterday) {
      dayStreak = Math.max(dayStreak, current.day_streak + 1);
    } else if (current && current.day_streak > 0 && current.streak_last_active_pht === today) {
      dayStreak = Math.max(dayStreak, current.day_streak);
    }
  } else if (yesterdayQualifies) {
    // Yesterday was qualifying; today is in progress and pending activity from one or both users.
    streakLastActivePht = yesterday;
    streakActiveToday = false;
    streakStatus = 'at_risk';
    expiresAt = phtEndOfDayUtc(today); // expires at 11:59:59 PM PHT tonight if not completed

    // Count consecutive qualifying days walking backward from yesterday
    let cursor = yesterday;
    while (validDates.has(cursor)) {
      dayStreak += 1;
      cursor = getCalendarDateOffset(cursor, -1);
    }

    // Critical data preservation
    if (current && current.day_streak > 0 && current.streak_last_active_pht === yesterday) {
      dayStreak = Math.max(dayStreak, current.day_streak);
    }
  } else {
    // Missed yesterday — streak is lapsed/expired
    dayStreak = 0;
    streakActiveToday = false;
    streakLastActivePht = current?.streak_last_active_pht ?? current?.lapsed_last_active_pht ?? null;

    if (streakLastActivePht) {
      const deadline = computeRestoreDeadline(streakLastActivePht);
      const isRestorable = deadline.getTime() > Date.now();
      streakStatus = isRestorable ? 'lapsed' : 'expired';
      expiresAt = isRestorable ? deadline.toISOString() : null;
      streakRestoreDeadline = isRestorable ? deadline.toISOString() : null;
    } else {
      streakStatus = 'inactive';
      expiresAt = null;
      streakRestoreDeadline = null;
    }
  }

  // If streak was active before and has now lapsed, record timeline event and lapse bookkeeping
  let lapsedEvent: model.StreakEventRow | null = null;
  if (!todayQualifies && !yesterdayQualifies && current && current.day_streak > 0 && current.streak_last_active_pht) {
    try {
      lapsedEvent = await model.markStreakLapsed(
        conversationId,
        current.day_streak,
        current.streak_last_active_pht,
      );
    } catch (err) {
      console.error('[StreakService] Failed to record streak lapse:', err);
    }
  }

  const prevStreak = current?.day_streak ?? 0;
  const prevLastActive = current?.streak_last_active_pht ?? null;

  // Persist to conversation_streaks if changed
  if (dayStreak !== prevStreak || streakLastActivePht !== prevLastActive) {
    await model.upsertStreak(conversationId, dayStreak, streakLastActivePht);
  }

  // Synchronize linked match in matches table (if any) — stage follows the streak
  await syncMatchProgression(conversationId, dayStreak, streakLastActivePht);

  const result: ConversationStreakResult = {
    dayStreak,
    streakActiveToday,
    streakStatus,
    lastQualifyingDate: streakLastActivePht,
    expiresAt,
    streakRestoreDeadline,
  };

  // Broadcast single authoritative realtime event to all conversation members
  const payload = {
    conversationId,
    dayStreak,
    streakActiveToday,
    streakStatus,
    lastQualifyingDate: streakLastActivePht,
    expiresAt,
    streakRestoreDeadline,
  };
  for (const memberId of allMemberIds) {
    emitToUser(memberId, 'conversation:streak_updated', payload);
    if (lapsedEvent) {
      emitToUser(memberId, 'conversation:streak_event', lapsedEvent);
    }
  }

  return result;
}

/**
 * Restores a lapsed streak for a conversation using one of the caller's
 * restore tokens. Broadcasts the restored streak and event to all members.
 */
export async function restoreConversationStreak(
  conversationId: string,
  userId: string,
  allMemberIds: string[],
): Promise<{ restoresRemaining: number; newStreak: number; event: model.StreakEventRow }> {
  let result: { restoresRemaining: number; newStreak: number; event: model.StreakEventRow };
  try {
    result = await model.restoreStreak(conversationId, userId);
  } catch (err: any) {
    if (err?.code === 'nothing_to_restore') {
      throw new HttpError('No streak to restore', 400);
    }
    if (err?.code === 'window_expired') {
      throw new HttpError(
        'The 42-hour streak restore window has expired. Start chatting to build a new streak!',
        400,
      );
    }
    if (err?.code === 'no_restores_left') {
      throw new HttpError('You have used all 5 streak restores for this month.', 400);
    }
    throw err;
  }

  // Sync matches table if linked match exists — restoring the streak also
  // restores the level it had earned.
  await syncMatchProgression(conversationId, result.newStreak, phtDateStr());

  const today = phtDateStr();
  const payload = {
    conversationId,
    dayStreak: result.newStreak,
    streakActiveToday: true,
    streakStatus: 'active' as const,
    lastQualifyingDate: today,
    expiresAt: phtEndOfDayUtc(getCalendarDateOffset(today, 1)),
    streakRestoreDeadline: null,
    status: 'restored',
  };
  for (const memberId of allMemberIds) {
    emitToUser(memberId, 'conversation:streak_updated', payload);
    emitToUser(memberId, 'conversation:streak_event', result.event);
  }

  return result;
}

/**
 * Returns the number of remaining restore tokens for a user.
 */
export async function getRestoreTokens(userId: string): Promise<number> {
  return model.getUserRestoreTokens(userId);
}
