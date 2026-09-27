-- 021_points_progression.sql
--
-- Re-engineers the progression system from streak-based to points-based.
-- Streaks are now only a bonus multiplier for points, not the gating mechanism.
--
-- Each stage requires 500 points to advance. Points come from completing
-- daily tasks (reset at 12 AM PHT). Tasks are additive per stage:
--   Stage 1: Send 1 message each  (+1 pt × multiplier)
--   Stage 2: + Play game ≥5 min   (+2 pts × multiplier)
--   Stage 3: + Send 1 photo each  (+3 pts × multiplier)
--   Stage 4: Feed unlock (no points needed — automatic on reaching S4)
--
-- Points multiplier = current_stage (1x, 2x, 3x).
-- Streak bonus: each streak day adds +0.5x on top of base multiplier (capped at +2x bonus).

-- ── Add points columns to matches ──────────────────────────────────────────
ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS match_points integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stage_points integer NOT NULL DEFAULT 0;
  -- match_points = cumulative all-time points
  -- stage_points = points in current stage (resets to 0 on stage advance)

-- ── Daily task completion log ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.match_daily_tasks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id    uuid NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  task_id     text NOT NULL,           -- 'send_message' | 'play_game' | 'send_photo'
  task_date   date NOT NULL,           -- PHT calendar date (YYYY-MM-DD)
  points_awarded integer NOT NULL DEFAULT 0,
  completed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT match_daily_tasks_unique UNIQUE (match_id, user_id, task_id, task_date)
);

CREATE INDEX IF NOT EXISTS match_daily_tasks_match_date_idx
  ON public.match_daily_tasks (match_id, task_date);

CREATE INDEX IF NOT EXISTS match_daily_tasks_user_date_idx
  ON public.match_daily_tasks (user_id, task_date);

-- ── RPC: award points for a completed task ──────────────────────────────────
-- Returns: points_awarded (0 if already completed today), new stage_points, new match_points
CREATE OR REPLACE FUNCTION public.award_task_points(
  p_match_id       uuid,
  p_user_id        uuid,
  p_task_id        text,
  p_task_date      date,
  p_base_points    integer,
  p_multiplier     numeric   -- e.g. 1.5 for stage 1 with a 1-day streak bonus
) RETURNS TABLE (
  points_awarded  integer,
  new_stage_points integer,
  new_match_points integer
) AS $$
DECLARE
  v_points integer;
  v_stage_pts integer;
  v_match_pts integer;
BEGIN
  -- Idempotent: if already completed today, return zeros
  IF EXISTS (
    SELECT 1 FROM public.match_daily_tasks
    WHERE match_id = p_match_id
      AND user_id  = p_user_id
      AND task_id  = p_task_id
      AND task_date = p_task_date
  ) THEN
    SELECT stage_points, match_points INTO v_stage_pts, v_match_pts
      FROM public.matches WHERE id = p_match_id;
    RETURN QUERY SELECT 0, v_stage_pts, v_match_pts;
    RETURN;
  END IF;

  v_points := GREATEST(1, ROUND(p_base_points * p_multiplier)::integer);

  INSERT INTO public.match_daily_tasks
    (match_id, user_id, task_id, task_date, points_awarded)
  VALUES
    (p_match_id, p_user_id, p_task_id, p_task_date, v_points)
  ON CONFLICT (match_id, user_id, task_id, task_date) DO NOTHING;

  -- Atomically increment both counters on the match row
  UPDATE public.matches
    SET stage_points = stage_points + v_points,
        match_points  = match_points  + v_points
    WHERE id = p_match_id
  RETURNING stage_points, match_points
    INTO v_stage_pts, v_match_pts;

  RETURN QUERY SELECT v_points, v_stage_pts, v_match_pts;
END;
$$ LANGUAGE plpgsql;

-- ── RPC: advance stage (resets stage_points) ───────────────────────────────
CREATE OR REPLACE FUNCTION public.advance_match_stage(
  p_match_id  uuid,
  p_new_stage smallint
) RETURNS void AS $$
BEGIN
  UPDATE public.matches
    SET current_stage = p_new_stage,
        stage_points  = 0
    WHERE id = p_match_id;
END;
$$ LANGUAGE plpgsql;

-- ── Helper: get today's completed tasks for a match ────────────────────────
CREATE OR REPLACE FUNCTION public.get_daily_task_status(
  p_match_id  uuid,
  p_task_date date
) RETURNS TABLE (
  user_id    uuid,
  task_id    text,
  completed  boolean,
  points_awarded integer
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    mdt.user_id,
    mdt.task_id,
    true AS completed,
    mdt.points_awarded
  FROM public.match_daily_tasks mdt
  WHERE mdt.match_id  = p_match_id
    AND mdt.task_date = p_task_date;
END;
$$ LANGUAGE plpgsql;
