// src/app/types/adminReports.types.ts

export type ReportStatus = 'pending' | 'reviewing' | 'resolved' | 'rejected';

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
}

export interface PaginatedReportList {
  items: AdminReportListItem[];
  nextCursor: string | null;
  total: number;
}
