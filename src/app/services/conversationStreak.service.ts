// src/app/services/conversationStreak.service.ts
//
// General conversation streak service — works for ALL conversation types
// (regular DMs, anonymous matches, revealed matches).
//
// ── Streak rules (PHT = Philippine Standard Time, UTC+8) ──────────────────
//
//   • A day resets at 12:00 AM PHT. At the start of a new day the streak
//     is "not yet active" — both members must send at least 1 message that
//     day to make it valid and extend the count.
//
//   • A PHT calendar day is "valid" when BOTH participants have sent ≥ 1
//     message between 12:00 AM and 11:59:59 PM PHT.
//
//   • The streak counter increments the moment the SECOND member sends their
//     first message of the day (completing the pair). Real-time broadcast
//     fires immediately so the badge lights up without a page refresh.
//
//   • If 12:00 AM PHT passes and EITHER member sent 0 messages that day,
//     the streak resets permanently to 0.
//
//   • Today's incomplete day never breaks the streak — it just doesn't
//     extend it yet.  A streak of N stays N until midnight.
//
// ── Flow per message send ──────────────────────────────────────────────────
//   1. incrementActivity(conversationId, senderId, todayPHT)
//   2. recomputeConversationStreak(conversationId)   ← read → maybe write
//   3. If streak changed → broadcast 'conversation:streak_updated' to all members


import { emitToUser } from './realtime.service';
import { phtDateStr, phtDateStrOffset } from '../utils/pht';
import * as model from '../models/conversationStreak.model';

export { MIN_MESSAGES_PER_VALID_DAY } from '../models/conversationStreak.model';

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Call this right after a message is successfully inserted.
 * Records today's PHT activity and recomputes the streak.
 */
export async function recordConversationMessage(
  conversationId: string,
  senderId: string,
  allMemberIds: string[],
): Promise<{ dayStreak: number }> {
  const today = phtDateStr();
  await model.incrementActivity(conversationId, senderId, today);
  return recomputeConversationStreak(conversationId, allMemberIds);
}

/**
 * Recomputes and persists the streak for a conversation.
 * Safe to call at any time (idempotent read-then-maybe-write).
 *
 * Algorithm:
 *   - Fetch all activity rows (up to 60 PHT days back).
 *   - Group by date → a date is "valid" when ≥2 distinct users each
 *     hit MIN_MESSAGES_PER_VALID_DAY.
 *   - Walk backwards from today PHT (or yesterday if today is not valid yet).
 *   - Count consecutive valid days → that's the streak.
 *   - Today's date is NEVER counted as breaking the streak even if it's
 *     incomplete — it just doesn't extend it yet.
 */
export async function recomputeConversationStreak(
  conversationId: string,
  allMemberIds: string[],
): Promise<{ dayStreak: number }> {
  const rows = await model.getDailyActivity(conversationId);
  const current = await model.getStreak(conversationId);

  // Build a Set<dateStr> of valid PHT days.
  // Group message counts by (date, userId).
  const byDate = new Map<string, Map<string, number>>();
  for (const row of rows) {
    let userMap = byDate.get(row.activity_date);
    if (!userMap) {
      userMap = new Map<string, number>();
      byDate.set(row.activity_date, userMap);
    }
    userMap.set(row.user_id, (userMap.get(row.user_id) ?? 0) + row.message_count);
  }

  const requiredParticipants = Math.min(allMemberIds.length, model.MIN_PARTICIPANTS_PER_VALID_DAY);

  const validDates = new Set<string>();
  for (const [date, userMap] of byDate.entries()) {
    const qualifyingUsers = [...userMap.entries()].filter(
      ([, count]) => count >= model.MIN_MESSAGES_PER_VALID_DAY,
    ).length;
    if (qualifyingUsers >= requiredParticipants) {
      validDates.add(date);
    }
  }

  // Walk streak backwards from today (or yesterday if today isn't valid yet).
  const today = phtDateStr();
  let cursor = validDates.has(today) ? today : phtDateStrOffset(-1);
  let dayStreak = 0;

  while (validDates.has(cursor)) {
    dayStreak += 1;
    // Step back one calendar day in PHT.
    const prev = new Date(`${cursor}T00:00:00+08:00`);
    prev.setDate(prev.getDate() - 1);
    cursor = prev.toISOString().slice(0, 10);
  }

  const streakLastActivePht = dayStreak > 0
    ? (validDates.has(today) ? today : phtDateStrOffset(-1))
    : null;

  const prevStreak = current?.day_streak ?? 0;
  if (dayStreak !== prevStreak || streakLastActivePht !== (current?.streak_last_active_pht ?? null)) {
    await model.upsertStreak(conversationId, dayStreak, streakLastActivePht);

    // Broadcast the updated streak to all members.
    const payload = { conversationId, dayStreak };
    for (const memberId of allMemberIds) {
      emitToUser(memberId, 'conversation:streak_updated', payload);
    }
  }

  return { dayStreak };
}
