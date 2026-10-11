// src/app/models/userPreferences.model.ts

import { supabaseAdmin } from '../../config/supabase';

export interface UserPreferences {
  user_id: string;
  matchmaking_paused: boolean;
  match_dept_preference: 'any' | 'same' | 'different';
  match_year_preference: 'any' | 'same' | 'upper';
  direct_request_policy: 'everyone' | 'allies_only' | 'none';
  show_online_status: boolean;
  show_last_active: boolean;
  read_receipts_enabled: boolean;
  profile_visibility?: 'campus' | 'matches_only' | 'hidden';
  feed_post_audience?: 'campus' | 'matches_only' | 'anonymous_only';
  default_post_audience: 'campus' | 'department' | 'allies';
  notify_chat_messages: boolean;
  notify_streak_reminders: boolean;
  notify_match_requests?: boolean;
  notify_match_found: boolean;
  notify_confessions?: boolean;
  notify_feed_activity: boolean;
  notify_sound_enabled: boolean;
  quiet_hours_enabled: boolean;
  quiet_hours_start: string;
  quiet_hours_end: string;
  created_at: string;
  updated_at: string;
}

export type UpdateUserPreferencesInput = Partial<
  Omit<UserPreferences, 'user_id' | 'created_at' | 'updated_at'>
>;

export const DEFAULT_USER_PREFERENCES: Omit<UserPreferences, 'user_id' | 'created_at' | 'updated_at'> = {
  matchmaking_paused: false,
  match_dept_preference: 'any',
  match_year_preference: 'any',
  direct_request_policy: 'everyone',
  show_online_status: true,
  show_last_active: true,
  read_receipts_enabled: true,
  profile_visibility: 'campus',
  feed_post_audience: 'campus',
  default_post_audience: 'campus',
  notify_chat_messages: true,
  notify_streak_reminders: true,
  notify_match_requests: true,
  notify_match_found: true,
  notify_confessions: true,
  notify_feed_activity: true,
  notify_sound_enabled: true,
  quiet_hours_enabled: false,
  quiet_hours_start: '22:00',
  quiet_hours_end: '07:00',
};

/**
 * Returns user preferences, automatically creating a default record if one does not exist yet.
 */
export async function getUserPreferences(userId: string): Promise<UserPreferences> {
  const { data, error } = await supabaseAdmin
    .from('user_preferences')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    console.error('[UserPreferences] Failed to fetch preferences:', error);
    // Graceful fallback to default preferences
    return {
      user_id: userId,
      ...DEFAULT_USER_PREFERENCES,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  }

  if (data) {
    return data as UserPreferences;
  }

  // Lazy insert defaults
  const newRow = {
    user_id: userId,
    ...DEFAULT_USER_PREFERENCES,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const { data: inserted, error: insertErr } = await supabaseAdmin
    .from('user_preferences')
    .insert(newRow)
    .select('*')
    .maybeSingle();

  if (insertErr || !inserted) {
    console.warn('[UserPreferences] Could not persist default preferences:', insertErr);
    return newRow as UserPreferences;
  }

  return inserted as UserPreferences;
}

/**
 * Updates user preferences atomically and returns the updated state.
 */
export async function updateUserPreferences(
  userId: string,
  updates: UpdateUserPreferencesInput,
): Promise<UserPreferences> {
  const payload = {
    ...updates,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabaseAdmin
    .from('user_preferences')
    .upsert(
      {
        user_id: userId,
        ...payload,
      },
      { onConflict: 'user_id' },
    )
    .select('*')
    .single();

  if (error || !data) {
    console.error('[UserPreferences] Failed to update preferences:', error);
    throw error;
  }

  return data as UserPreferences;
}
