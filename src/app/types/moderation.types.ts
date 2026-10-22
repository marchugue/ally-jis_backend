
export interface BlockRow {
  blocker_id: string;
  blocked_id: string;
  created_at: string;
}

export interface ReportRow {
  id: string;
  created_at: string;
}

export interface CreateReportParams {
  reporterId: string;
  reportedUserId: string;
  violationId: string;
  conversationId?: string | null;
  postId?: string | null;
  messageId?: string | null;
  notes?: string | null;
}

export interface BlockUserResult {
  success: true;
  blockedAt: string;
}

// Request bodies (mirror BlockUserPayload / ReportUserPayload on the frontend)
export interface BlockUserPayload {
  blockedUserId: string;
}

export interface ReportUserPayload {
  reportedUserId: string;
  violationId: string;
  conversationId?: string | null;
  postId?: string | null;
  messageId?: string | null;
  notes?: string | null;
}

export interface BlockedUserRow {
  id: string;
  fullName: string | null;
  username: string | null;
  avatarUrl: string | null;
  blockedAt: string;
}

export interface UnblockUserResult {
  success: true;
}

// Restrict types
export interface RestrictRow {
  restricter_id: string;
  restricted_id: string;
  created_at: string;
}

export interface RestrictUserPayload {
  restrictedUserId: string;
}

export interface RestrictUserResult {
  success: true;
  restrictedAt: string;
}

export interface UnrestrictUserResult {
  success: true;
}

export interface RestrictedUserRow {
  id: string;
  fullName: string | null;
  username: string | null;
  avatarUrl: string | null;
  restrictedAt: string;
}

// Mute types
export interface MuteRow {
  muter_id: string;
  muted_id: string;
  created_at: string;
}

export interface MuteUserPayload {
  mutedUserId: string;
}

export interface MuteUserResult {
  success: true;
  mutedAt: string;
}

export interface UnmuteUserResult {
  success: true;
}

export interface MutedUserRow {
  id: string;
  fullName: string | null;
  username: string | null;
  avatarUrl: string | null;
  mutedAt: string;
}