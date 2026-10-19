-- 028_game_multiplayer.sql
--
-- 2-Player game mode for the Ally game portal (Tic-Tac-Toe, Secret Clue, 2048 Merge).
--
--   * game_sessions       — one row per invite / live duel between two users.
--   * game_results        — one row per player per finished duel (feeds the leaderboard).
--   * game_leaderboard    — aggregated per-user, per-game standings.
--
-- Run in the Supabase SQL Editor BEFORE deploying the backend changes that
-- add /api/games/* and the game:* socket events.
--
-- NOTE: game invites are sent into the existing chat conversation as a normal
-- message; the chat card status is derived from game_sessions.invite_message_id,
-- so the `messages` table is intentionally NOT altered.

-- ── 1. Sessions ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.game_sessions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id            TEXT NOT NULL CHECK (game_id IN ('ttt', 'clue', 'merge')),

  host_id            UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  guest_id           UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,

  -- Chat thread the invite lives in, plus the anonymous match (if any) the two
  -- players are paired through. match_id drives the `play_game` daily task.
  conversation_id    UUID REFERENCES public.conversations(id) ON DELETE SET NULL,
  match_id           UUID REFERENCES public.matches(id) ON DELETE SET NULL,
  invite_message_id  UUID REFERENCES public.messages(id) ON DELETE SET NULL,

  status             TEXT NOT NULL DEFAULT 'invited'
                     CHECK (status IN ('invited', 'active', 'finished', 'declined', 'cancelled', 'expired', 'abandoned')),

  -- Server-authoritative, game-specific state (board, round, deck index, ...).
  state              JSONB NOT NULL DEFAULT '{}'::jsonb,
  turn_user_id       UUID,

  host_score         INTEGER NOT NULL DEFAULT 0,
  guest_score        INTEGER NOT NULL DEFAULT 0,
  winner_id          UUID,
  is_draw            BOOLEAN NOT NULL DEFAULT FALSE,
  end_reason         TEXT,

  -- Set when a rematch spawns a follow-up session.
  rematch_of         UUID REFERENCES public.game_sessions(id) ON DELETE SET NULL,

  invite_expires_at  TIMESTAMPTZ,
  started_at         TIMESTAMPTZ,
  ended_at           TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT game_sessions_distinct_players CHECK (host_id <> guest_id)
);

CREATE INDEX IF NOT EXISTS idx_game_sessions_host   ON public.game_sessions (host_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_game_sessions_guest  ON public.game_sessions (guest_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_game_sessions_status ON public.game_sessions (status);
CREATE INDEX IF NOT EXISTS idx_game_sessions_invite_message
  ON public.game_sessions (invite_message_id) WHERE invite_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_game_sessions_conversation
  ON public.game_sessions (conversation_id) WHERE conversation_id IS NOT NULL;

-- ── 2. Results (one row per player per finished duel) ────────────────────────
CREATE TABLE IF NOT EXISTS public.game_results (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id    UUID NOT NULL REFERENCES public.game_sessions(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  opponent_id   UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  game_id       TEXT NOT NULL CHECK (game_id IN ('ttt', 'clue', 'merge')),
  result        TEXT NOT NULL CHECK (result IN ('win', 'loss', 'draw')),
  points        INTEGER NOT NULL DEFAULT 0,
  score         INTEGER NOT NULL DEFAULT 0,
  duration_sec  INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT game_results_unique_per_player UNIQUE (session_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_game_results_user      ON public.game_results (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_game_results_game_rank ON public.game_results (game_id, user_id);

-- ── 3. Leaderboard view ──────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.game_leaderboard AS
SELECT
  user_id,
  game_id,
  COUNT(*) FILTER (WHERE result = 'win')::int   AS wins,
  COUNT(*) FILTER (WHERE result = 'loss')::int  AS losses,
  COUNT(*) FILTER (WHERE result = 'draw')::int  AS draws,
  COUNT(*)::int                                 AS games_played,
  COALESCE(SUM(points), 0)::int                 AS points,
  COALESCE(MAX(score), 0)::int                  AS best_score,
  MAX(created_at)                               AS last_played_at
FROM public.game_results
GROUP BY user_id, game_id;

-- ── 4. Lock everything to the backend (service role only) ────────────────────
ALTER TABLE public.game_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_results  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.game_leaderboard FROM anon, authenticated;
