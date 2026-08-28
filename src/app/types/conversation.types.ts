export type BlockStatus = 'none' | 'blockedByMe' | 'blockedByOther' | 'mutual';

export interface MessageReplyRow {
  id: string;
  sender_id: string;
  content: string | null;
  image_url?: string | null;
}

export interface MessageReactionRow {
  message_id: string;
  user_id: string;
  emoji: string;
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
  reactions?: MessageReactionRow[];
  /** True when the sender deleted the message for everyone. */
  is_deleted?: boolean;
  deleted_at?: string | null;
}

export interface ConversationMemberRow {
  conversation_id: string;
  user_id: string;
  last_read_at?: string | null;
  icebreakers_enabled?: boolean;
  profiles?: ProfileSummary | ProfileSummary[];
  /** When set, messages older than this timestamp are hidden for this member. */
  cleared_at?: string | null;
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
  icebreakersEnabled?: boolean;
  variant?: ConversationVariant;
  matchInfo?: ConversationMatchInfo | null;
  /** PHT-based consecutive-day streak for this conversation (all types). */
  dayStreak?: number;
}

export type ConversationVariant = 'regular' | 'anonymous' | 'anonymous_ended';

export interface ConversationMatchInfo {
  matchId: string;
  stage: number;
  dayStreak: number;
  myAlias: string | null;
  myAvatar: string | null;
  partnerAlias: string | null;
  partnerAvatar: string | null;
  ended: boolean;
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

export interface SetMessageReactionPayload {
  emoji: string | null;
}

/** Body for DELETE /conversations/:id/messages/:messageId */
export interface DeleteMessagePayload {
  mode: 'delete_for_me' | 'delete_for_everyone';
}
