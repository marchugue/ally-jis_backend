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
