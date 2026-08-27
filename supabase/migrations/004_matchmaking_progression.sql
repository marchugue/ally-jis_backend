-- 004_matchmaking_progression.sql
--
-- Phase 2: stage progression + day-aware streaks. Additive, doesn't touch
-- 002_matchmaking.sql or 003_matchmaking_identity.sql.
--
-- Unlike 002's RPCs, increment_match_daily_activity() below is fully
-- owned by this migration — the Node layer (matchmaking.model.ts) only
-- ever calls it, never hand-rolls the increment, so there's exactly one
-- place that knows how a "day" gets counted.

ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS current_stage smallint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS day_streak integer NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.match_daily_activity (
  match_id uuid NOT NULL REFERENCES public.matches(id),
  activity_date date NOT NULL,
  user_a_message_count integer NOT NULL DEFAULT 0,
  user_b_message_count integer NOT NULL DEFAULT 0,
  CONSTRAINT match_daily_activity_pkey PRIMARY KEY (match_id, activity_date)
);

-- Atomic upsert-increment for "user X sent a message in match Y today".
-- Called once per message from conversation.service.ts#sendMessage (via
-- matchmaking.service.ts) — never batched, so plain ON CONFLICT DO UPDATE
-- is enough, no advisory locking needed.
CREATE OR REPLACE FUNCTION public.increment_match_daily_activity(
  p_match_id uuid,
  p_activity_date date,
  p_is_user_a boolean
) RETURNS void AS $$
BEGIN
  IF p_is_user_a THEN
    INSERT INTO public.match_daily_activity (match_id, activity_date, user_a_message_count, user_b_message_count)
    VALUES (p_match_id, p_activity_date, 1, 0)
    ON CONFLICT (match_id, activity_date)
    DO UPDATE SET user_a_message_count = match_daily_activity.user_a_message_count + 1;
  ELSE
    INSERT INTO public.match_daily_activity (match_id, activity_date, user_a_message_count, user_b_message_count)
    VALUES (p_match_id, p_activity_date, 0, 1)
    ON CONFLICT (match_id, activity_date)
    DO UPDATE SET user_b_message_count = match_daily_activity.user_b_message_count + 1;
  END IF;
END;
$$ LANGUAGE plpgsql;
