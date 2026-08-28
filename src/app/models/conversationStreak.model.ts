// src/app/models/conversationStreak.model.ts
//
// Database access for the general conversation streak system.
// All date strings passed here MUST be PHT-local (use phtDateStr()
// from utils/pht.ts) — the conversation_daily_activity.activity_date
// column stores plain dates with no timezone, so the caller is the
// single source of timezone truth.

import { supabaseAdmin } from '../../config/supabase';

/** 1 message from each participant per PHT day makes that day valid.
 * A single exchange ("hi" / "hey") is enough — showing up is what counts. */
export const MIN_MESSAGES_PER_VALID_DAY = 1;
export const MIN_PARTICIPANTS_PER_VALID_DAY = 2; // both sides must have sent messages

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

/**
 * Bulk-fetch streaks for a list of conversation ids.
 * Returns a Map<conversationId, day_streak>.
 */
export async function getStreaksForConversations(
  conversationIds: string[],
): Promise<Map<string, number>> {
  if (conversationIds.length === 0) return new Map();

  const { data, error } = await supabaseAdmin
    .from('conversation_streaks')
    .select('conversation_id, day_streak')
    .in('conversation_id', conversationIds);
  if (error) throw error;

  const map = new Map<string, number>();
  for (const row of data ?? []) {
    map.set(row.conversation_id as string, row.day_streak as number);
  }
  return map;
}
