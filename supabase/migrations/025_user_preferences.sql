-- 025_user_preferences.sql
--
-- Dedicated user settings and preferences persistence table.
-- Stores client user choices for:
--   1. Matchmaking & Discovery (pause matching, department filter, year filter, direct requests)
--   2. Privacy & Safety (online presence visibility, read receipts, default post audience)
--   3. Notifications & Alerts (chat messages, 10 PM PHT streak warning, match alerts, feed activity, quiet hours)

CREATE TABLE IF NOT EXISTS public.user_preferences (
  user_id                   UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,

  -- Matchmaking & Discovery
  matchmaking_paused        BOOLEAN NOT NULL DEFAULT FALSE,
  match_dept_preference     TEXT NOT NULL DEFAULT 'any',     -- 'any' | 'same' | 'different'
  match_year_preference     TEXT NOT NULL DEFAULT 'any',     -- 'any' | 'same' | 'upper'
  direct_request_policy     TEXT NOT NULL DEFAULT 'everyone',-- 'everyone' | 'allies_only' | 'none'

  -- Privacy
  show_online_status        BOOLEAN NOT NULL DEFAULT TRUE,
  show_last_active          BOOLEAN NOT NULL DEFAULT TRUE,
  read_receipts_enabled     BOOLEAN NOT NULL DEFAULT TRUE,
  profile_visibility        TEXT NOT NULL DEFAULT 'campus',  -- 'campus' | 'matches_only' | 'hidden'
  feed_post_audience        TEXT NOT NULL DEFAULT 'campus',  -- 'campus' | 'matches_only' | 'anonymous_only'
  default_post_audience     TEXT NOT NULL DEFAULT 'campus',

  -- Notifications
  notify_chat_messages      BOOLEAN NOT NULL DEFAULT TRUE,
  notify_streak_reminders   BOOLEAN NOT NULL DEFAULT TRUE,   -- 10 PM PHT streak warning
  notify_match_requests     BOOLEAN NOT NULL DEFAULT TRUE,
  notify_match_found        BOOLEAN NOT NULL DEFAULT TRUE,
  notify_confessions        BOOLEAN NOT NULL DEFAULT TRUE,
  notify_feed_activity      BOOLEAN NOT NULL DEFAULT TRUE,
  notify_sound_enabled      BOOLEAN NOT NULL DEFAULT TRUE,
  quiet_hours_enabled       BOOLEAN NOT NULL DEFAULT FALSE,
  quiet_hours_start         TEXT NOT NULL DEFAULT '22:00',
  quiet_hours_end           TEXT NOT NULL DEFAULT '07:00',

  -- Timestamps
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_preferences_user_id ON public.user_preferences(user_id);
