-- 006_follows.sql
--
-- Asymmetric Follow relationship — distinct from the existing symmetric
-- "ally" relationship (user_interactions, status='accepted'). Following
-- someone doesn't require them to follow back, and doesn't touch
-- user_interactions or conversations at all.

CREATE TABLE IF NOT EXISTS public.follows (
  follower_id uuid NOT NULL REFERENCES public.profiles(id),
  followed_id uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT follows_pkey PRIMARY KEY (follower_id, followed_id),
  CONSTRAINT follows_no_self_follow CHECK (follower_id <> followed_id)
);

-- Both directions get queried constantly (followers list, following list,
-- counts) — the primary key covers (follower_id, followed_id) lookups and
-- "who does X follow", but "who follows X" needs its own index.
CREATE INDEX IF NOT EXISTS follows_followed_id_idx ON public.follows (followed_id);
