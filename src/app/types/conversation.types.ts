export interface MessageRow {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string | null;
  image_url?: string | null;
  created_at: string;
}

export interface ConversationMemberRow {
  conversation_id: string;
  user_id: string;
  last_read_at?: string | null;
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
}
