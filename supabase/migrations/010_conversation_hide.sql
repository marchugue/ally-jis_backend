-- 010_conversation_hide.sql
--
-- "Delete" from the chat list is per-member, not a real delete — the
-- conversation and its messages stay intact for the other member(s),
-- exactly like WhatsApp/Messenger's "delete chat". If the other side
-- sends a new message, it reappears (see conversation.service.ts#sendMessage,
-- which clears hidden_at for a recipient who had it hidden).

ALTER TABLE public.conversation_members
  ADD COLUMN IF NOT EXISTS hidden_at timestamp with time zone;
