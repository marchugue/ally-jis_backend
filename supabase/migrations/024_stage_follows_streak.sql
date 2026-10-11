-- 024_stage_follows_streak.sql
--
-- Level progression now ends together with the streak.
--
-- Before: matches.current_stage only ever went UP (GREATEST(stage, stageForStreak)),
-- so a match that reached Lv.3 (7-day streak, photo sharing) stayed at Lv.3 even
-- after its streak ended and day_streak dropped to 0.
--
-- After: Lv.1–3 are derived from the live streak (3d → Lv.2, 7d → Lv.3).
-- Lv.4 (Campus Allies) is a permanent milestone and is never lowered.
-- Revealed matches are left untouched.
--
-- This one-time heal brings already-stuck matches back in line. The backend
-- keeps them in sync from here on (message send, restore, midnight cron, and
-- lazy reconciliation when conversations are loaded).

CREATE OR REPLACE FUNCTION public.stage_for_streak(p_days integer)
RETURNS smallint
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_days >= 10 THEN 4
    WHEN p_days >= 7  THEN 3
    WHEN p_days >= 3  THEN 2
    ELSE 1
  END::smallint;
$$;

-- Use the live conversation streak when available (falls back to the match's own).
WITH live AS (
  SELECT
    m.id,
    CASE
      WHEN cs.day_streak > 0
       AND cs.streak_last_active_pht >= ((now() AT TIME ZONE 'Asia/Manila')::date - 1)
      THEN cs.day_streak
      ELSE 0
    END AS live_streak
  FROM public.matches m
  LEFT JOIN public.conversation_streaks cs ON cs.conversation_id = m.conversation_id
  WHERE m.current_stage < 4
    AND m.revealed_at IS NULL
)
UPDATE public.matches m
   SET current_stage = public.stage_for_streak(live.live_streak),
       day_streak    = live.live_streak,
       updated_at    = now()
  FROM live
 WHERE m.id = live.id
   AND (m.current_stage <> public.stage_for_streak(live.live_streak)
        OR m.day_streak <> live.live_streak);
