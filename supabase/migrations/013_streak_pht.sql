-- 013_streak_pht.sql
--
-- General conversation streak system (Philippine Standard Time, UTC+8).
--
-- A "streak day" starts at 12:00 AM PHT and ends at 11:59:59 PM PHT.
-- A day only counts if BOTH (or all) participants each sent ≥3 messages
-- during that PHT calendar day.  The streak breaks if any PHT calendar
-- day (excluding today, which may still be in progress) is missing a
-- valid entry in conversation_daily_activity.
--
-- This replaces the match-only `match_daily_activity` approach — all
-- conversations get streaks, including regular DMs.
--
-- The backend Node layer (conversationStreak.model.ts) is responsible
-- for always writing PHT-local date strings (YYYY-MM-DD) so the date
-- column here has no timezone of its own.

-- ──────────────────────────────────────────────────────────────────────────
-- 1. Helper: convert a UTC timestamptz to a PHT (UTC+8) date string.
--    Used by Node helper phtDateStr() — mirrored here for any direct
--    Postgres jobs that may want it.
-- ──────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.utc_to_pht_date(ts timestamptz)
RETURNS date AS $$
  SELECT (ts AT TIME ZONE 'Asia/Manila')::date;
$$ LANGUAGE sql IMMUTABLE;

-- ──────────────────────────────────────────────────────────────────────────
-- 2. Daily activity table — one row per (conversation, PHT date, user).
-- ──────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.conversation_daily_activity (
  conversation_id uuid  NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  activity_date   date  NOT NULL,   -- PHT local date (YYYY-MM-DD), written by Node
  user_id         uuid  NOT NULL,
  message_count   integer NOT NULL DEFAULT 0,
  CONSTRAINT conversation_daily_activity_pkey
    PRIMARY KEY (conversation_id, activity_date, user_id)
);

CREATE INDEX IF NOT EXISTS idx_conv_daily_activity_conv_date
  ON public.conversation_daily_activity (conversation_id, activity_date);

-- ──────────────────────────────────────────────────────────────────────────
-- 3. Streak snapshot — one row per conversation, updated on every valid day.
-- ──────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.conversation_streaks (
  conversation_id       uuid NOT NULL PRIMARY KEY REFERENCES public.conversations(id) ON DELETE CASCADE,
  day_streak            integer NOT NULL DEFAULT 0,
  streak_last_active_pht date,          -- last PHT date that was a valid streak day
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- ──────────────────────────────────────────────────────────────────────────
-- 4. Atomic upsert-increment RPC — called once per message send.
--    The Node layer passes the PHT date string so all timezone logic
--    stays in one place (phtDateStr() in the service layer).
-- ──────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.increment_conversation_daily_activity(
  p_conversation_id uuid,
  p_activity_date   date,
  p_user_id         uuid
) RETURNS void AS $$
BEGIN
  INSERT INTO public.conversation_daily_activity
    (conversation_id, activity_date, user_id, message_count)
  VALUES
    (p_conversation_id, p_activity_date, p_user_id, 1)
  ON CONFLICT (conversation_id, activity_date, user_id)
  DO UPDATE SET message_count = conversation_daily_activity.message_count + 1;
END;
$$ LANGUAGE plpgsql;

-- ──────────────────────────────────────────────────────────────────────────
-- 5. Migrate existing match_daily_activity to PHT dates (back-fill only
--    rows that would change; expression is idempotent once aligned).
-- ──────────────────────────────────────────────────────────────────────────
UPDATE public.match_daily_activity
SET activity_date = public.utc_to_pht_date(activity_date::timestamptz)
WHERE activity_date <> public.utc_to_pht_date(activity_date::timestamptz);

-- ──────────────────────────────────────────────────────────────────────────
-- 6. Add streak_last_active_pht to matches for the legacy match-streak path.
-- ──────────────────────────────────────────────────────────────────────────
ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS streak_last_active_pht date;
