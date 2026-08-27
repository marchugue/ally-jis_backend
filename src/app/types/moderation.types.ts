
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