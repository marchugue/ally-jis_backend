-- ============================================================
-- Migration: conversations.type column (anonymous / allied)
-- Run in Supabase SQL Editor BEFORE deploying backend changes.
-- ============================================================

-- 1. Add the type column. Defaults to 'anonymous' so all existing
--    conversations start in the safe / identity-hidden state.
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'anonymous'
  CHECK (type IN ('anonymous', 'allied'));

-- 2. Back-fill: any conversation that belongs to a REVEALED match
--    (i.e. the two users completed the roadmap) should be 'allied'.
UPDATE conversations c
  SET type = 'allied'
  FROM matches m
  WHERE m.conversation_id = c.id
    AND m.revealed_at IS NOT NULL;

-- 3. Index for fast filtering by type (used in conversation lists).
CREATE INDEX IF NOT EXISTS idx_conversations_type ON conversations(type);
