-- 003_matchmaking_identity.sql
--
-- Additive migration for Phase 1 of the anonymous matchmaking feature.
-- Does NOT touch anything defined in migrations/002_matchmaking.sql —
-- no existing function, trigger, or column is modified. Everything here
-- is a new nullable column, so it's safe to run against a database that
-- already has live rows in `matches` and `profiles`.
--
-- Run this with the Supabase CLI (`supabase db push`) or paste it into
-- the SQL editor in the Supabase dashboard.

-- ---------------------------------------------------------------------------
-- Anonymous alias/avatar per match
-- ---------------------------------------------------------------------------
-- Assigned once, in Node (see app/services/matchmaking.service.ts), the
-- moment a match is reserved — not here in SQL — so the pool of names/
-- avatars can be tweaked without a migration. Stored on the match row
-- (not the queue or a separate table) because a match is exactly the
-- scope an alias needs to stay stable for: for the lifetime of the
-- match, both sides always see the same "Anonymous Fox" for their
-- partner, and it's meaningless outside that match.

ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS user_a_alias text,
  ADD COLUMN IF NOT EXISTS user_a_avatar text,
  ADD COLUMN IF NOT EXISTS user_b_alias text,
  ADD COLUMN IF NOT EXISTS user_b_avatar text;

-- ---------------------------------------------------------------------------
-- Profile fields for future compatibility scoring / gradual-reveal stages
-- ---------------------------------------------------------------------------
-- Not read by the matching algorithm or by any reveal logic yet — Phase 1
-- only collects them (profile edit form) so they're populated by the time
-- Phase 2 (stage progression) needs them. age_range and gender_preference
-- are asked as explicit self-reported buckets/preferences, not exact
-- birthdate, on purpose.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS zodiac_sign text,
  ADD COLUMN IF NOT EXISTS personality_type text,
  ADD COLUMN IF NOT EXISTS music_taste text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS movie_interests text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS age_range text,
  ADD COLUMN IF NOT EXISTS match_gender_preference text;
