-- 019_streak_restores.sql
-- Adds per-user streak restore tokens (default 5) and an audit log
-- for conversation streak restores.

-- 1. Add restore token pool to profiles (default 5 per user)
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS streak_restores INT NOT NULL DEFAULT 5;

-- 2. Audit table: one row per restore action
CREATE TABLE IF NOT EXISTS conversation_streak_restores (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id  UUID        NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  restored_by      UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  previous_streak  INT         NOT NULL DEFAULT 0,
  restored_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_streak_restores_conversation
  ON conversation_streak_restores (conversation_id);

CREATE INDEX IF NOT EXISTS idx_streak_restores_user
  ON conversation_streak_restores (restored_by);
