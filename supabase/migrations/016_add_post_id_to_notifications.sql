-- ==============================================================================
-- 016_add_post_id_to_notifications.sql
-- Adds post_id and comment_id columns to notifications table for direct navigation
-- ==============================================================================

alter table public.notifications
  add column if not exists post_id uuid references public.posts(id) on delete cascade,
  add column if not exists comment_id uuid references public.post_comments(id) on delete cascade;

create index if not exists notifications_post_id_idx on public.notifications (post_id);
create index if not exists notifications_comment_id_idx on public.notifications (comment_id);
