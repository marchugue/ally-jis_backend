-- Migration: Create preset_avatars table
-- Run this in your Supabase SQL editor or migration tool.

CREATE TABLE IF NOT EXISTS preset_avatars (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label       text,
  url         text NOT NULL,
  r2_path     text NOT NULL,
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Index to keep list queries fast
CREATE INDEX IF NOT EXISTS preset_avatars_sort_order_idx ON preset_avatars (sort_order ASC);

-- Enable RLS (admin bypass via service role key; public read-only)
ALTER TABLE preset_avatars ENABLE ROW LEVEL SECURITY;

-- Anyone can read preset avatars (used in onboarding / profile picker)
CREATE POLICY "preset_avatars_public_read"
  ON preset_avatars FOR SELECT
  USING (true);

-- Only the service role (backend) can insert / update / delete
-- (the backend always uses supabaseAdmin which bypasses RLS)
