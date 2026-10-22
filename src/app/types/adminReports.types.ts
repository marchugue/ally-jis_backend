// src/app/types/adminReports.types.ts

export type ReportStatus = 'pending' | 'reviewing' | 'resolved' | 'rejected';

export interface AdminReportPostMedia {
  id: string;
  url: string;
  position: number;
}

export interface AdminReportPost {
  id: string;
  author_id: string;
  author_username?: string | null;
  author_name?: string | null;
  author_avatar?: string | null;
  content: string;
  audience?: string;
  likes_count?: number;
  comments_count?: number;
  created_at: string;
  media?: AdminReportPostMedia[];
  is_deleted?: boolean;
}

export interface AdminReportMessage {
  id: string;
  conversation_id: string | null;
  sender_id: string | null;
  sender_username?: string | null;
  sender_name?: string | null;
  sender_avatar?: string | null;
  content: string;
  image_url?: string | null;
  created_at: string;
  is_deleted?: boolean;
  is_reported?: boolean;
}

export interface AdminReportMessageDetail extends AdminReportMessage {
  /** A few messages around the reported one (oldest -> newest), including the reported message itself. */
  context: AdminReportMessage[];
}

export interface AdminReportListItem {
  id: string;
  reporter_id: string | null;
  reporter_username: string | null;
  reporter_name?: string | null;
  reporter_email?: string | null;
  reporter_avatar?: string | null;
  reported_user_id: string | null;
  reported_username: string | null;
  reported_name?: string | null;
  reported_email?: string | null;
  reported_avatar?: string | null;
  violation_id: string;
  violation_label: string;
  category_id: string;
  category_label: string;
  conversation_id: string | null;
  post_id?: string | null;
  post?: AdminReportPost | null;
  message_id?: string | null;
  message?: AdminReportMessageDetail | null;
  status: ReportStatus;
  internal_notes: string | null;
  created_at: string;
  reviewed_at: string | null;
}

export interface ListReportsParams {
  status?: ReportStatus | 'all';
  categoryId?: string;
  cursor?: string | null;
  limit?: number;
  targetType?: 'all' | 'post' | 'user' | 'message';
}

export interface PaginatedReportList {
  items: AdminReportListItem[];
  nextCursor: string | null;
  total: number;
}
