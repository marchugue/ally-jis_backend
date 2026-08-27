-- 012_deletion_engine.sql
--
-- Adds two complementary deletion layers:
--
-- 1. CONVERSATION-LEVEL (per-user, non-destructive)
--    cleared_at on conversation_members: when set, the user no longer sees
--    messages older than this timestamp. The conversation itself and the
--    other participant's history are untouched. Distinct from hidden_at
--    (which just removes the thread from the inbox list).
--
-- 2. MESSAGE-LEVEL
--    a) Global tombstone: is_deleted + deleted_at on messages.
--       Used by "Delete for everyone" — replaces content/image_url with
--       NULL and shows a placeholder bubble to all participants.
--    b) Per-user soft-delete: deleted_messages_user junction table.
--       Used by "Delete for me" — removes the message from one user's view
--       only; all other participants see it normally.

-- 1. Conversation permanent-clear support
ALTER TABLE public.conversation_members
  ADD COLUMN IF NOT EXISTS cleared_at TIMESTAMP WITH TIME ZONE DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_conv_members_user_cleared
  ON public.conversation_members (conversation_id, user_id, cleared_at);

-- 2. Message global-deletion tombstone
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS deleted_at  TIMESTAMP WITH TIME ZONE DEFAULT NULL;

-- 3. Per-user message-deletion junction table
CREATE TABLE IF NOT EXISTS public.deleted_messages_user (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES auth.users(id)  ON DELETE CASCADE,
  message_id UUID NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, message_id)
);

CREATE INDEX IF NOT EXISTS idx_deleted_messages_user_lookup
  ON public.deleted_messages_user (user_id, message_id);
