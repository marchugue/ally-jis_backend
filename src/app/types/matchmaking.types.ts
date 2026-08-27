export type QueueStatus = 'searching' | 'reserved';

export interface QueueRow {
  id: string;
  user_id: string;
  status: QueueStatus;
  joined_at: string;
  updated_at: string;
}

export type MatchStatus =
  | 'pending'
  | 'declined'
  | 'timed_out'
  | 'chatting'
  | 'expired'
  | 'confirmed'
  | 'ended';

export interface MatchRow {
  id: string;
  user_a_id: string;
  user_b_id: string;
  status: MatchStatus;
  compatibility_score: number;
  accepted_a: boolean;
  accepted_b: boolean;
  conversation_id: string | null;
  streak_count: number;
  last_sender_id: string | null;
  accept_expires_at: string | null;
  chat_expires_at: string | null;
  confirmed_at: string | null;
  ended_at: string | null;
  created_at: string;
  updated_at: string;
  // Added in migrations/003_matchmaking_identity.sql. Nullable because
  // rows created before a match reaches 'pending' won't have these set
  // yet, and matches created before this migration ran won't have them
  // at all — always fall back gracefully, never assume non-null.
  user_a_alias?: string | null;
  user_a_avatar?: string | null;
  user_b_alias?: string | null;
  user_b_avatar?: string | null;
  // Added in migrations/004_matchmaking_progression.sql.
  current_stage: number;
  day_streak: number;
  // Added in migrations/005_matchmaking_reveal_link.sql.
  revealed_at: string | null;
}

export interface CandidateResult {
  match_id: string;
  candidate_id: string;
  compatibility_score: number;
}

export interface MatchmakingStatus {
  queueEntry: QueueRow | null;
  activeMatch: MatchRow | null;
}

/**
 * The anonymized, viewer-specific view of a match — "my" alias/avatar
 * vs "their" alias/avatar, resolved from user_a/user_b based on which
 * side the requesting user is on. Never includes the partner's real
 * user id, name, or any profile field. Merge this into any HTTP/socket
 * payload alongside a MatchRow instead of trusting callers to do the
 * user_a/user_b lookup themselves.
 */
export interface MatchIdentityView {
  myAlias: string;
  myAvatar: string;
  partnerAlias: string;
  partnerAvatar: string;
}