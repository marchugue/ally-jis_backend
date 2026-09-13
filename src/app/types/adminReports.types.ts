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

export interface AdminReportListItem {
  id: string;
  reporter_id: string | null;
  reporter_username: string | null;
  reported_user_id: string | null;
  reported_username: string | null;
  violation_id: string;
  violation_label: string;
  category_id: string;
  category_label: string;
  conversation_id: string | null;
  post_id?: string | null;
  post?: AdminReportPost | null;
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
  targetType?: 'all' | 'post' | 'user';
}

export interface PaginatedReportList {
  items: AdminReportListItem[];
  nextCursor: string | null;
  total: number;
}
