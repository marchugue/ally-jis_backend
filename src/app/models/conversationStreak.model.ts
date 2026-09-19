// src/app/models/conversationStreak.model.ts
//
// Database access for the general conversation streak system.
// All date strings passed here MUST be PHT-local (use phtDateStr()
// from utils/pht.ts) — the conversation_daily_activity.activity_date
// column stores plain dates with no timezone, so the caller is the
// single source of timezone truth.

import { supabaseAdmin } from '../../config/supabase';
import { phtDateStr, phtDateStrOffset } from '../utils/pht';

/** 1 message from each participant per PHT day makes that day valid.
 * A single exchange ("hi" / "hey") is enough — showing up is what counts. */
export const MIN_MESSAGES_PER_VALID_DAY = 1;
export const MIN_PARTICIPANTS_PER_VALID_DAY = 2; // both sides must have sent messages

/** Maximum restore tokens a user can hold. */
export const MAX_STREAK_RESTORES = 5;

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DailyActivityUserRow {
  activity_date: string;  // YYYY-MM-DD (PHT)
  user_id: string;
  message_count: number;
}

export interface ConversationStreakRow {
  conversation_id: string;
  day_streak: number;
  streak_last_active_pht: string | null;
  updated_at: string;
}

// ─── Write ────────────────────────────────────────────────────────────────────

/**
 * Atomic upsert-increment — one row per (conversation, date, user).
 * Called once per message send, after the message has been persisted.
 */
export async function incrementActivity(
  conversationId: string,
  userId: string,
  phtDate: string,
): Promise<void> {
  const { error } = await supabaseAdmin.rpc('increment_conversation_daily_activity', {
    p_conversation_id: conversationId,
    p_activity_date: phtDate,
    p_user_id: userId,
  });
  if (error) throw error;
}

/**
 * Persists the computed streak back to conversation_streaks (upsert).
 */
export async function upsertStreak(
  conversationId: string,
  dayStreak: number,
  streakLastActivePht: string | null,
): Promise<void> {
  const { error } = await supabaseAdmin
    .from('conversation_streaks')
    .upsert(
      {
        conversation_id: conversationId,
        day_streak: dayStreak,
        streak_last_active_pht: streakLastActivePht,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'conversation_id' },
    );
  if (error) throw error;
}

// ─── Read ─────────────────────────────────────────────────────────────────────

/**
 * Fetches the last 60 PHT activity days for a conversation (newest first).
 * 60 days gives generous headroom beyond the longest streak threshold.
 */
export async function getDailyActivity(conversationId: string): Promise<DailyActivityUserRow[]> {
  const { data, error } = await supabaseAdmin
    .from('conversation_daily_activity')
    .select('activity_date, user_id, message_count')
    .eq('conversation_id', conversationId)
    .order('activity_date', { ascending: false })
    .limit(60 * 10); // up to 10 users × 60 days — bounded
  if (error) throw error;
  return (data ?? []) as DailyActivityUserRow[];
}

/**
 * Returns the current stored streak for a conversation, or null if none.
 */
export async function getStreak(conversationId: string): Promise<ConversationStreakRow | null> {
  const { data, error } = await supabaseAdmin
    .from('conversation_streaks')
    .select('*')
    .eq('conversation_id', conversationId)
    .maybeSingle();
  if (error) throw error;
  return (data as ConversationStreakRow | null) ?? null;
}

export interface ConversationStreakResult {
  dayStreak: number;
  streakActiveToday: boolean;
  /**
   * ISO UTC timestamp — the deadline by which the user can still restore a
   * lapsed streak (streak_last_active_pht + 1 day at midnight PHT + 42 hours).
   * Present only when the streak has lapsed (dayStreak === 0 and a prior
   * streak existed). Null otherwise.
   */
  streakRestoreDeadline: string | null;
}

/**
 * Computes the restore deadline for a lapsed streak.
 *
 * The streak broke at midnight PHT the day after the last active day.
 * Users have 42 hours from that midnight to restore their streak.
 *
 * deadline = midnight PHT of (streakLastActivePht + 1 day) + 42 hours
 */
export function computeRestoreDeadline(streakLastActivePht: string): Date {
  // Midnight PHT of the day AFTER the last active day (= when the streak broke)
  const brokeAtPht = new Date(`${streakLastActivePht}T00:00:00.000+08:00`);
  brokeAtPht.setDate(brokeAtPht.getDate() + 1);
  // Add 42 hours
  return new Date(brokeAtPht.getTime() + 42 * 60 * 60 * 1000);
}

/**
 * Computes the effective day streak and whether today is activated.
 *
 * FIXED: removed the previous `streakLastActivePht === yesterday → +1` inflation.
 * The stored `day_streak` is the authoritative count. Showing +1 before today
 * is actually activated was misleading and could diverge from a fresh recompute.
 *
 * - If last active today: streak is storedStreak, active today ✅
 * - If last active yesterday: streak is storedStreak, NOT yet activated today (pending) 🟡
 * - If last active before yesterday (or none): streak has expired → 0 ❌
 *   In the lapsed case, streakRestoreDeadline is set to the 42h window deadline.
 */
export function computeEffectiveStreak(
  storedStreak: number,
  streakLastActivePht: string | null,
): ConversationStreakResult {
  if (!streakLastActivePht) {
    return { dayStreak: 0, streakActiveToday: false, streakRestoreDeadline: null };
  }

  const today = phtDateStr();
  const yesterday = phtDateStrOffset(-1);

  if (storedStreak > 0 && streakLastActivePht === today) {
    // Both participants chatted today — streak is live and active.
    return { dayStreak: storedStreak, streakActiveToday: true, streakRestoreDeadline: null };
  } else if (storedStreak > 0 && streakLastActivePht === yesterday) {
    // Yesterday was the last active day; today hasn't been activated yet.
    // Show the existing streak count (do NOT add +1 — it hasn't been earned yet).
    return { dayStreak: storedStreak, streakActiveToday: false, streakRestoreDeadline: null };
  } else {
    // Missed a day (or midnight reset) — streak has lapsed. Compute the 42-hour restore deadline.
    const deadline = computeRestoreDeadline(streakLastActivePht);
    return { dayStreak: 0, streakActiveToday: false, streakRestoreDeadline: deadline.toISOString() };
  }
}

/**
 * Bulk-fetch streaks for a list of conversation ids.
 * Returns a Map<conversationId, { dayStreak, streakActiveToday }>.
 */
export async function getStreaksForConversations(
  conversationIds: string[],
): Promise<Map<string, ConversationStreakResult>> {
  if (conversationIds.length === 0) return new Map();

  const { data, error } = await supabaseAdmin
    .from('conversation_streaks')
    .select('conversation_id, day_streak, streak_last_active_pht')
    .in('conversation_id', conversationIds);
  if (error) throw error;

  const map = new Map<string, ConversationStreakResult>();
  for (const row of data ?? []) {
    map.set(
      row.conversation_id as string,
      computeEffectiveStreak(
        (row.day_streak as number) ?? 0,
        row.streak_last_active_pht as string | null,
      ),
    );
  }
  return map;
}

// ─── Restore ─────────────────────────────────────────────────────────────────

/**
 * Returns the number of remaining streak restore tokens for a user.
 */
export async function getUserRestoreTokens(userId: string): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('streak_restores')
    .eq('id', userId)
    .single();
  if (error) throw error;
  return (data?.streak_restores as number) ?? 0;
}

/**
 * Restores a lapsed streak for a conversation.
 * - Validates the user has at least 1 restore token.
 * - Decrements `profiles.streak_restores` by 1.
 * - Sets `conversation_streaks.streak_last_active_pht` to today PHT
 *   so the streak is immediately considered active today.
 * - Logs the restore to `conversation_streak_restores`.
 *
 * Returns the remaining token count after the operation.
 * Throws if the user has no tokens remaining.
 */
export async function restoreStreak(
  conversationId: string,
  userId: string,
  previousStreak: number,
): Promise<{ restoresRemaining: number; newStreak: number }> {
  // 1. Check token balance
  const remaining = await getUserRestoreTokens(userId);
  if (remaining <= 0) {
    throw new Error('No streak restore tokens remaining');
  }

  // 2. Determine the restored streak value:
  //    If previousStreak > 0, keep it. If 0, restore to 1 (day 1 restart).
  const newStreak = previousStreak > 0 ? previousStreak : 1;
  const today = phtDateStr();

  // 3. Decrement token (atomic update with check)
  const { error: tokenErr } = await supabaseAdmin
    .from('profiles')
    .update({ streak_restores: remaining - 1 })
    .eq('id', userId)
    .eq('streak_restores', remaining); // optimistic lock
  if (tokenErr) throw tokenErr;

  // 4. Write the restored streak as active today
  const { error: streakErr } = await supabaseAdmin
    .from('conversation_streaks')
    .upsert(
      {
        conversation_id: conversationId,
        day_streak: newStreak,
        streak_last_active_pht: today,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'conversation_id' },
    );
  if (streakErr) throw streakErr;

  // 5. Audit log
  await supabaseAdmin
    .from('conversation_streak_restores')
    .insert({
      conversation_id: conversationId,
      restored_by: userId,
      previous_streak: previousStreak,
    })
    .then(({ error }) => {
      if (error) console.warn('[StreakRestore] Failed to insert audit row:', error);
    });

  return { restoresRemaining: remaining - 1, newStreak };
}
