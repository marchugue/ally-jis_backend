-- Migration 018: Add post_id to reports table
-- Allows linking moderation reports directly to posts

ALTER TABLE reports ADD COLUMN IF NOT EXISTS post_id UUID REFERENCES posts(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_reports_post_id ON reports(post_id);
