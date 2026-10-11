// src/app/models/conversationStreak.model.ts
//
// Database access for the general conversation streak system.
// All date strings passed here MUST be PHT-local (use phtDateStr()
// from utils/pht.ts) — the conversation_daily_activity.activity_date
// column stores plain dates with no timezone, so the caller is the
// single source of timezone truth.

import { supabaseAdmin } from '../../config/supabase';
import { phtDateStr, phtDateStrOffset, getCalendarDateOffset, phtEndOfDayUtc } from '../utils/pht';

/** 1 message from each participant per PHT day makes that day valid.
 * A single exchange ("hi" / "hey") is enough — showing up is what counts. */
export const MIN_MESSAGES_PER_VALID_DAY = 1;
export const MIN_PARTICIPANTS_PER_VALID_DAY = 2; // both sides must have sent messages

/** Restore allowance per user per PHT calendar month. */
export const MAX_STREAK_RESTORES = 5;

/** Hours a broken streak stays restorable, counted from the moment it breaks. */
export const RESTORE_WINDOW_HOURS = 42;

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
  /** Count of the most recently broken streak, kept so it can be restored exactly. */
  lapsed_streak?: number | null;
  /** Last qualifying PHT day of the broken streak (deadline anchor). */
  lapsed_last_active_pht?: string | null;
  updated_at: string;
}

export type StreakEventType = 'ended' | 'restored';

export interface StreakEventRow {
  id: string;
  conversation_id: string;
  event_type: StreakEventType;
  streak_count: number;
  actor_id: string | null;
  last_active_pht: string | null;
  restore_deadline: string | null;
  created_at: string;
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

export type StreakStatus = 'active' | 'at_risk' | 'lapsed' | 'expired' | 'inactive';

export interface ConversationStreakResult {
  dayStreak: number;
  streakActiveToday: boolean;
  streakStatus: StreakStatus;
  lastQualifyingDate: string | null;
  expiresAt: string | null;
  /**
   * ISO UTC timestamp — the deadline by which a lapsed streak can still be
   * restored. Present only while a broken streak exists. Null otherwise.
   */
  streakRestoreDeadline: string | null;
  /** The count a restore would bring back (0 when nothing is restorable). */
  lapsedStreak?: number;
}

/** Midnight PHT at the END of the missed day — the moment a streak breaks. */
export function computeStreakBrokeAt(streakLastActivePht: string): Date {
  const brokeDateStr = getCalendarDateOffset(streakLastActivePht, 2);
  return new Date(`${brokeDateStr}T00:00:00.000+08:00`);
}

/**
 * Computes the restore deadline for a lapsed streak.
 *
 * Example: last mutual day Mon → Tue is the at-risk day → the streak breaks
 * Wed 00:00 PHT → restorable until Thu 18:00 PHT (42h).
 *
 * Must stay in sync with SQL streak_restore_deadline() in migration 023.
 */
export function computeRestoreDeadline(streakLastActivePht: string): Date {
  const brokeAt = computeStreakBrokeAt(streakLastActivePht);
  return new Date(brokeAt.getTime() + RESTORE_WINDOW_HOURS * 60 * 60 * 1000);
}

/**
 * Computes the authoritative effective day streak and status.
 *
 * - Last active today → active, safe until end of tomorrow.
 * - Last active yesterday → at_risk until midnight tonight.
 * - Otherwise → broken. 'lapsed' while the 42h window is open, then 'expired'.
 *
 * `lapsed` carries the remembered broken-streak count once the midnight job
 * (or the lazy path) has recorded it; before that, the stored count is used.
 */
export function computeEffectiveStreak(
  storedStreak: number,
  streakLastActivePht: string | null,
  lapsed?: { lapsedStreak?: number | null; lapsedLastActivePht?: string | null },
): ConversationStreakResult {
  const today = phtDateStr();
  const yesterday = getCalendarDateOffset(today, -1);

  if (storedStreak > 0 && streakLastActivePht === today) {
    return {
      dayStreak: storedStreak,
      streakActiveToday: true,
      streakStatus: 'active',
      lastQualifyingDate: today,
      expiresAt: phtEndOfDayUtc(getCalendarDateOffset(today, 1)),
      streakRestoreDeadline: null,
      lapsedStreak: 0,
    };
  }

  if (storedStreak > 0 && streakLastActivePht === yesterday) {
    return {
      dayStreak: storedStreak,
      streakActiveToday: false,
      streakStatus: 'at_risk',
      lastQualifyingDate: yesterday,
      expiresAt: phtEndOfDayUtc(today),
      streakRestoreDeadline: null,
      lapsedStreak: 0,
    };
  }

  // Broken (or never started). Prefer the remembered lapsed streak; fall back
  // to a stored streak that the midnight job has not processed yet.
  const lapsedCount =
    (lapsed?.lapsedStreak ?? 0) > 0 ? (lapsed!.lapsedStreak as number)
    : storedStreak > 0 ? storedStreak
    : 0;
  const lapsedAnchor =
    (lapsed?.lapsedStreak ?? 0) > 0 ? (lapsed?.lapsedLastActivePht ?? null)
    : storedStreak > 0 ? streakLastActivePht
    : null;

  if (lapsedCount <= 0 || !lapsedAnchor) {
    return {
      dayStreak: 0,
      streakActiveToday: false,
      streakStatus: 'inactive',
      lastQualifyingDate: streakLastActivePht,
      expiresAt: null,
      streakRestoreDeadline: null,
      lapsedStreak: 0,
    };
  }

  const deadline = computeRestoreDeadline(lapsedAnchor);
  const isRestorable = deadline.getTime() > Date.now();
  return {
    dayStreak: 0,
    streakActiveToday: false,
    streakStatus: isRestorable ? 'lapsed' : 'expired',
    lastQualifyingDate: lapsedAnchor,
    expiresAt: isRestorable ? deadline.toISOString() : null,
    streakRestoreDeadline: isRestorable ? deadline.toISOString() : null,
    lapsedStreak: isRestorable ? lapsedCount : 0,
  };
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
    .select('conversation_id, day_streak, streak_last_active_pht, lapsed_streak, lapsed_last_active_pht')
    .in('conversation_id', conversationIds);
  if (error) throw error;

  const map = new Map<string, ConversationStreakResult>();
  for (const row of data ?? []) {
    map.set(
      row.conversation_id as string,
      computeEffectiveStreak(
        (row.day_streak as number) ?? 0,
        row.streak_last_active_pht as string | null,
        {
          lapsedStreak: row.lapsed_streak as number | null,
          lapsedLastActivePht: row.lapsed_last_active_pht as string | null,
        },
      ),
    );
  }
  return map;
}

// ─── Restore ─────────────────────────────────────────────────────────────────────────

/** Current PHT month key ('YYYY-MM') the restore allowance belongs to. */
export function phtMonthKey(now: Date = new Date()): string {
  return phtDateStr(now).slice(0, 7);
}

/**
 * Returns the user's remaining restores for the current PHT month.
 * Refills to 5 automatically when a new month has started.
 */
export async function getUserRestoreTokens(userId: string): Promise<number> {
  const { data, error } = await supabaseAdmin.rpc('get_streak_restores', {
    p_user_id: userId,
    p_month: phtMonthKey(),
  });
  if (error) throw error;
  return (data as number) ?? 0;
}

export type RestoreFailure = 'nothing_to_restore' | 'window_expired' | 'no_restores_left';

/**
 * Atomically restores the conversation's lapsed streak to its exact previous
 * count, spending one of the caller's monthly restores and writing a
 * 'restored' timeline event. See restore_conversation_streak() in migration 023.
 */
export async function restoreStreak(
  conversationId: string,
  userId: string,
): Promise<{ restoresRemaining: number; newStreak: number; event: StreakEventRow }> {
  const { data, error } = await supabaseAdmin.rpc('restore_conversation_streak', {
    p_conversation_id: conversationId,
    p_user_id: userId,
    p_month: phtMonthKey(),
    p_today: phtDateStr(),
  });
  if (error) {
    const failure = (['nothing_to_restore', 'window_expired', 'no_restores_left'] as RestoreFailure[])
      .find((code) => error.message?.includes(code));
    if (failure) {
      const err = new Error(failure) as Error & { code: RestoreFailure };
      err.code = failure;
      throw err;
    }
    throw error;
  }
  const result = data as { new_streak: number; restores_remaining: number; event: StreakEventRow };
  return {
    restoresRemaining: result.restores_remaining,
    newStreak: result.new_streak,
    event: result.event,
  };
}

// ─── Lapse bookkeeping + timeline events ───────────────────────────────────────────────

/**
 * Records that a streak broke: remembers its count for a possible restore,
 * zeroes the live count, and inserts the 'ended' timeline event dated to the
 * moment the streak actually broke. Idempotent — returns null if this broken
 * streak was already recorded.
 */
export async function markStreakLapsed(
  conversationId: string,
  brokenStreak: number,
  lastActivePht: string,
): Promise<StreakEventRow | null> {
  const deadline = computeRestoreDeadline(lastActivePht);

  const { data: event, error: evErr } = await supabaseAdmin
    .from('conversation_streak_events')
    .insert({
      conversation_id: conversationId,
      event_type: 'ended',
      streak_count: brokenStreak,
      last_active_pht: lastActivePht,
      restore_deadline: deadline.toISOString(),
      created_at: computeStreakBrokeAt(lastActivePht).toISOString(),
    })
    .select('*')
    .single();

  // 23505 = unique violation → already recorded by the cron or a concurrent request.
  if (evErr && (evErr as { code?: string }).code === '23505') return null;
  if (evErr) throw evErr;

  const { error: upErr } = await supabaseAdmin
    .from('conversation_streaks')
    .update({
      day_streak: 0,
      lapsed_streak: brokenStreak,
      lapsed_last_active_pht: lastActivePht,
      updated_at: new Date().toISOString(),
    })
    .eq('conversation_id', conversationId)
    .eq('streak_last_active_pht', lastActivePht); // don't clobber a newer streak
  if (upErr) throw upErr;

  return event as StreakEventRow;
}

/** Most recent streak events for a conversation (oldest first). */
export async function getStreakEvents(conversationId: string, limit = 50): Promise<StreakEventRow[]> {
  const { data, error } = await supabaseAdmin
    .from('conversation_streak_events')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return ((data ?? []) as StreakEventRow[]).reverse();
}
