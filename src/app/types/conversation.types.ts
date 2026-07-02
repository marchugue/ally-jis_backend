export type BlockStatus = 'none' | 'blockedByMe' | 'blockedByOther' | 'mutual';

export interface MessageReplyRow {
  id: string;
  sender_id: string;
  content: string | null;
  image_url?: string | null;
}

export interface MessageRow {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string | null;
  image_url?: string | null;
  created_at: string;
  reply_to_message_id?: string | null;
  replied_message?: MessageReplyRow | MessageReplyRow[] | null;
}

export interface ConversationMemberRow {
  conversation_id: string;
  user_id: string;
  last_read_at?: string | null;
  icebreakers_enabled?: boolean;
  profiles?: ProfileSummary | ProfileSummary[];
}

export interface ProfileSummary {
  id: string;
  full_name?: string | null;
  username?: string | null;
  avatar_url?: string | null;
  interests?: string[];
}

export interface ConversationRow {
  id: string;
  updated_at: string;
  messages?: MessageRow[];
  conversation_members?: ConversationMemberRow[];
  blockStatus?: BlockStatus;
}

export interface ConversationIdResponse {
  conversationId: string;
}

export interface ConversationWithUserResponse {
  conversationId: string | null;
}

export interface ConversationMembershipRow {
  conversation_id: string;
  last_read_at?: string | null;
}

export interface CreateConversationPayload {
  targetUserId: string;
}

export interface MarkReadPayload {
  readAt: string;
}

export interface SendMessagePayload {
  content: string | null;
  imageUrl?: string | null;
  replyToMessageId?: string | null;
}

export interface UpdateIcebreakersPayload {
  enabled: boolean;
}

