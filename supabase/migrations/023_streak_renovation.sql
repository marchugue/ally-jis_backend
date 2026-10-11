-- 023_streak_renovation.sql
--
-- Streak system renovation:
--   1. Monthly restore allowance (5 per user, refilled on the 1st of each PHT month).
--   2. Lapsed-streak memory on conversation_streaks so a broken streak can be
--      restored to its exact previous count within 42h (the count is no longer
--      lost when the display value drops to 0).
--   3. conversation_streak_events — persisted "ended" / "restored" timeline
--      events rendered as flat labels among chat bubbles on web + mobile.
--   4. restore_conversation_streak() — one atomic transaction for
--      window check + token spend + streak write + event insert.
--
-- Restore window rule: the streak breaks at midnight PHT at the END of the
-- missed day, i.e. (last_active + 2 days) 00:00 PHT. Restorable for 42h after.

-- ── 1. Monthly restore allowance ───────────────────────────────────────────
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS streak_restores_month TEXT; -- 'YYYY-MM' (PHT) the allowance belongs to

-- ── 2. Lapsed-streak memory ───────────────────────────────────────────────
ALTER TABLE conversation_streaks
  ADD COLUMN IF NOT EXISTS lapsed_streak INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lapsed_last_active_pht DATE;

-- ── 3. Timeline events ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS conversation_streak_events (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id  UUID        NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  event_type       TEXT        NOT NULL CHECK (event_type IN ('ended', 'restored')),
  streak_count     INT         NOT NULL DEFAULT 0,
  actor_id         UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  -- For 'ended': the last active PHT date of the streak that broke. Used both
  -- for idempotency (one 'ended' per broken streak) and deadline math.
  last_active_pht  DATE,
  restore_deadline TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_streak_events_conversation
  ON conversation_streak_events (conversation_id, created_at DESC);

-- One 'ended' event per broken streak (cron + lazy path can both try).
CREATE UNIQUE INDEX IF NOT EXISTS uq_streak_events_ended
  ON conversation_streak_events (conversation_id, last_active_pht)
  WHERE event_type = 'ended';

-- ── Helpers ───────────────────────────────────────────────────────────────

-- Restore deadline for a streak whose last qualifying PHT day was p_last_active.
CREATE OR REPLACE FUNCTION streak_restore_deadline(p_last_active DATE)
RETURNS TIMESTAMPTZ
LANGUAGE sql IMMUTABLE AS $$
  SELECT ((p_last_active + 2)::timestamp AT TIME ZONE 'Asia/Manila') + INTERVAL '42 hours';
$$;

-- Returns the user's restore balance, refilling to 5 if a new PHT month began.
CREATE OR REPLACE FUNCTION get_streak_restores(p_user_id UUID, p_month TEXT)
RETURNS INT
LANGUAGE plpgsql AS $$
DECLARE
  v_remaining INT;
BEGIN
  UPDATE profiles
     SET streak_restores = 5,
         streak_restores_month = p_month
   WHERE id = p_user_id
     AND streak_restores_month IS DISTINCT FROM p_month;

  SELECT streak_restores INTO v_remaining FROM profiles WHERE id = p_user_id;
  RETURN COALESCE(v_remaining, 0);
END;
$$;

-- Atomic restore. Raises:
--   'nothing_to_restore' — no lapsed streak on record
--   'window_expired'     — the 42h window has passed
--   'no_restores_left'   — caller has used all 5 restores this month
CREATE OR REPLACE FUNCTION restore_conversation_streak(
  p_conversation_id UUID,
  p_user_id         UUID,
  p_month           TEXT,
  p_today           DATE
)
RETURNS JSON
LANGUAGE plpgsql AS $$
DECLARE
  v_row        conversation_streaks%ROWTYPE;
  v_remaining  INT;
  v_event      conversation_streak_events%ROWTYPE;
BEGIN
  SELECT * INTO v_row
    FROM conversation_streaks
   WHERE conversation_id = p_conversation_id
   FOR UPDATE;

  IF NOT FOUND OR v_row.lapsed_streak <= 0 OR v_row.lapsed_last_active_pht IS NULL THEN
    RAISE EXCEPTION 'nothing_to_restore';
  END IF;

  IF now() >= streak_restore_deadline(v_row.lapsed_last_active_pht) THEN
    RAISE EXCEPTION 'window_expired';
  END IF;

  PERFORM get_streak_restores(p_user_id, p_month);

  UPDATE profiles
     SET streak_restores = streak_restores - 1
   WHERE id = p_user_id
     AND streak_restores > 0
  RETURNING streak_restores INTO v_remaining;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'no_restores_left';
  END IF;

  UPDATE conversation_streaks
     SET day_streak = v_row.lapsed_streak,
         streak_last_active_pht = p_today,
         lapsed_streak = 0,
         lapsed_last_active_pht = NULL,
         updated_at = now()
   WHERE conversation_id = p_conversation_id;

  INSERT INTO conversation_streak_events (conversation_id, event_type, streak_count, actor_id)
  VALUES (p_conversation_id, 'restored', v_row.lapsed_streak, p_user_id)
  RETURNING * INTO v_event;

  -- Legacy audit log (kept for admin history)
  INSERT INTO conversation_streak_restores (conversation_id, restored_by, previous_streak)
  VALUES (p_conversation_id, p_user_id, v_row.lapsed_streak);

  RETURN json_build_object(
    'new_streak', v_row.lapsed_streak,
    'restores_remaining', v_remaining,
    'event', row_to_json(v_event)
  );
END;
$$;
