export type InteractionStatus = 'pending' | 'accepted' | 'rejected';

export interface InteractionRow {
  user_id: string;
  target_user_id: string;
  status: InteractionStatus;
  accepted_at?: string | null;
}

export interface AcceptConnectionResponse {
  conversationId: string;
}

export interface ConnectionStatusResponse {
  status: InteractionStatus | null;
}

/** Bidirectional status — the single request/accept/reject status above
 * only ever reflects one direction, which can't distinguish "I sent them
 * a request" from "they sent me one". This is what the profile page's
 * relationship button actually needs. */
export type RelationshipStatus = 'none' | 'pending_outgoing' | 'pending_incoming' | 'allies';

export interface RelationshipStatusResponse {
  status: RelationshipStatus;
}

export interface AllyListItem {
  id: string;
  username: string | null;
  fullName: string | null;
  avatarUrl: string | null;
  course: string | null;
  alliedAt: string;
}

export interface PaginatedAllyList {
  items: AllyListItem[];
  nextCursor: string | null;
}

export interface IncomingInteractionsPayload {
  requesterIds: string[];
}

export interface RequestInteractionPayload {
  targetUserId: string;
}

export interface AcceptInteractionPayload {
  requesterId: string;
}

export interface RejectInteractionPayload {
  targetUserId: string;
}
