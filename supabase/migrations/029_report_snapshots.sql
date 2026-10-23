-- 029_report_snapshots.sql
-- Store reported messages and reported posts in dedicated snapshot tables
-- so that content is permanently preserved for moderation even if deleted by students.

-- 1. Add message_id and reporter_notes to public.reports (no restrictive FK so historical/deleted messages don't fail)
ALTER TABLE public.reports 
  ADD COLUMN IF NOT EXISTS message_id UUID,
  ADD COLUMN IF NOT EXISTS reporter_notes TEXT;

CREATE INDEX IF NOT EXISTS idx_reports_message_id ON public.reports(message_id);

-- 2. Create reported_message_snapshots table
CREATE TABLE IF NOT EXISTS public.reported_message_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES public.reports(id) ON DELETE CASCADE,
  message_id UUID,
  conversation_id UUID,
  sender_id UUID,
  sender_username TEXT,
  sender_name TEXT,
  sender_avatar TEXT,
  content TEXT,
  image_url TEXT,
  message_created_at TIMESTAMPTZ,
  context_messages JSONB DEFAULT '[]'::jsonb,
  is_deleted_in_chat BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reported_msg_snapshots_report_id ON public.reported_message_snapshots(report_id);
CREATE INDEX IF NOT EXISTS idx_reported_msg_snapshots_msg_id ON public.reported_message_snapshots(message_id);

-- 3. Create reported_post_snapshots table
CREATE TABLE IF NOT EXISTS public.reported_post_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES public.reports(id) ON DELETE CASCADE,
  post_id UUID,
  author_id UUID,
  author_username TEXT,
  author_name TEXT,
  author_avatar TEXT,
  content TEXT,
  audience TEXT,
  media JSONB DEFAULT '[]'::jsonb,
  likes_count INTEGER DEFAULT 0,
  comments_count INTEGER DEFAULT 0,
  post_created_at TIMESTAMPTZ,
  is_deleted_from_feed BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reported_post_snapshots_report_id ON public.reported_post_snapshots(report_id);
CREATE INDEX IF NOT EXISTS idx_reported_post_snapshots_post_id ON public.reported_post_snapshots(post_id);

-- 4. Enable RLS and Grant Permissions
ALTER TABLE public.reported_message_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reported_post_snapshots ENABLE ROW LEVEL SECURITY;

GRANT ALL ON TABLE public.reported_message_snapshots TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.reported_post_snapshots TO anon, authenticated, service_role;

DROP POLICY IF EXISTS "Allow service_role full access to reported_message_snapshots" ON public.reported_message_snapshots;
CREATE POLICY "Allow service_role full access to reported_message_snapshots"
  ON public.reported_message_snapshots FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow authenticated read reported_message_snapshots" ON public.reported_message_snapshots;
CREATE POLICY "Allow authenticated read reported_message_snapshots"
  ON public.reported_message_snapshots FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Allow service_role full access to reported_post_snapshots" ON public.reported_post_snapshots;
CREATE POLICY "Allow service_role full access to reported_post_snapshots"
  ON public.reported_post_snapshots FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow authenticated read reported_post_snapshots" ON public.reported_post_snapshots;
CREATE POLICY "Allow authenticated read reported_post_snapshots"
  ON public.reported_post_snapshots FOR SELECT TO authenticated USING (true);

-- 5. Backfill existing legacy reports
-- Backfill message_id and reporter_notes from internal_notes containing [MSG:...]
UPDATE public.reports
SET 
  message_id = (substring(internal_notes from '\[MSG:([a-f0-9-]{36})\]'))::uuid,
  reporter_notes = nullif(trim(regexp_replace(internal_notes, '^\s*\[MSG:[a-f0-9-]{36}\]\s*', '')), '')
WHERE internal_notes ~* '\[MSG:[a-f0-9-]{36}\]'
  AND message_id IS NULL;

-- Backfill post_id and reporter_notes from internal_notes containing [POST:...]
UPDATE public.reports
SET 
  post_id = COALESCE(post_id, (substring(internal_notes from '\[POST:([a-f0-9-]{36})\]'))::uuid),
  reporter_notes = nullif(trim(regexp_replace(internal_notes, '^\s*\[POST:[a-f0-9-]{36}\]\s*', '')), '')
WHERE internal_notes ~* '\[POST:[a-f0-9-]{36}\]'
  AND (post_id IS NULL OR reporter_notes IS NULL);

-- Clean internal_notes where it was solely the tag or reporter notes
UPDATE public.reports
SET internal_notes = NULL
WHERE internal_notes ~* '^\s*\[(MSG|POST):[a-f0-9-]{36}\]'
  AND (reporter_notes = trim(regexp_replace(internal_notes, '^\s*\[(MSG|POST):[a-f0-9-]{36}\]\s*', ''))
       OR trim(regexp_replace(internal_notes, '^\s*\[(MSG|POST):[a-f0-9-]{36}\]\s*', '')) = '');
