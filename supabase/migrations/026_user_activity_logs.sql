-- 026_user_activity_logs.sql
--
-- Facebook-Style Personal Activity Log Table.
-- Stores a private chronological timeline of user actions across:
--   1. Content & Interactions ('content'): posts created, comments made, reactions.
--   2. Allies & Connections ('connections'): ally requests, accepted connections, follows.
--   3. Security & Logins ('security'): logins, password changes, credential updates.
--   4. Privacy & Safety ('safety'): blocks, unblocks, reports filed.

CREATE TABLE IF NOT EXISTS public.user_activity_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,

  -- Categorization
  bucket          VARCHAR(32) NOT NULL, -- 'content' | 'connections' | 'security' | 'safety'
  action          VARCHAR(64) NOT NULL, -- e.g. 'post:created', 'comment:created', 'auth:login'

  -- Human-readable Summary for Quick Display
  title           TEXT NOT NULL,        -- e.g. "You commented on Alex's post"
  summary         TEXT,                 -- e.g. "Good luck on midterms!"

  -- Navigation Target
  target_type     VARCHAR(32),          -- 'post' | 'profile' | 'comment' | 'security'
  target_id       TEXT,                 -- UUID or reference identifier

  -- Device & Environment Details
  device_info     TEXT,                 -- e.g. "Ally Mobile (Android)", "Chrome / Linux"
  ip_address      VARCHAR(45),          -- IPv4 or IPv6

  -- Metadata
  metadata        JSONB DEFAULT '{}'::jsonb,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Fast Timeline Query Indexes
CREATE INDEX IF NOT EXISTS idx_user_activity_logs_user_date
  ON public.user_activity_logs (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_activity_logs_user_bucket_date
  ON public.user_activity_logs (user_id, bucket, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_activity_logs_action
  ON public.user_activity_logs (action);

-- Enable Row Level Security
ALTER TABLE public.user_activity_logs ENABLE ROW LEVEL SECURITY;

-- RLS: Users can only select and delete their own activity logs
CREATE POLICY "Users can view own activity logs"
  ON public.user_activity_logs
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own activity logs"
  ON public.user_activity_logs
  FOR DELETE
  USING (auth.uid() = user_id);
