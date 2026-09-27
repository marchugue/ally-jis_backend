-- ==============================================================================
-- 022_facebook_style_notifications.sql
-- Facebook-Style Notification Architecture:
-- Adds grouping, categorization, unread count tracking, and replacement support
-- ==============================================================================

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS group_key text,
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS unread_count integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS target_id text,
  ADD COLUMN IF NOT EXISTS is_dismissed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Index for instant lookup of existing unread notifications by group key per user
CREATE INDEX IF NOT EXISTS notifications_user_group_idx 
  ON public.notifications (user_id, group_key);

-- Index for filtering by category (messages, connections, ally, safety, activity)
CREATE INDEX IF NOT EXISTS notifications_user_category_idx 
  ON public.notifications (user_id, category);

-- Index for unread notification count and badge queries
CREATE INDEX IF NOT EXISTS notifications_user_unread_idx 
  ON public.notifications (user_id, is_read);
