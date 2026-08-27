-- 005_matchmaking_reveal_link.sql
--
-- Marks the point a match's conversation stops being treated as
-- "anonymous" anywhere (chat list, notifications, chat header) and
-- becomes an ordinary conversation — set once the two sides accept a
-- friend request (see interaction.service.ts#acceptConnection, which
-- calls matchmaking.model.ts#markRevealedIfMatched). The match row
-- itself is untouched otherwise — current_stage/day_streak stay as a
-- historical record of how the match progressed.

ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS revealed_at timestamp with time zone;
