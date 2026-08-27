// src/app/types/admin.types.ts

export type AdminRole = 'moderator' | 'admin' | 'super_admin';
export type UserRole = 'student' | AdminRole;

export type Permission =
  | 'manage_users'
  | 'manage_bots'
  | 'view_reports'
  | 'resolve_reports'
  | 'delete_users'
  | 'ban_users'
  | 'view_analytics'
  | 'manage_settings'
  | 'manage_admins';

export interface RolePermissionRow {
  role: AdminRole;
  permission: Permission;
}

export interface AdminActivityLogRow {
  id: string;
  admin_id: string;
  action: string;
  target_user_id: string | null;
  metadata: Record<string, unknown> | null;
  ip_address: string | null;
  created_at: string;
}

export interface DashboardKpis {
  totalUsers: number;
  activeUsers: number; // seen in the last 7 days (user_presence)
  bannedUsers: number;
  reportedUsers: number; // distinct users with at least one report against them
  newUsersToday: number;
  onlineUsers: number; // seen in the last 5 minutes
  pendingReports: number;
  newUsersThisWeek: number;
  newUsersThisMonth: number;
}

export interface TimeSeriesPoint {
  date: string; // YYYY-MM-DD
  count: number;
}

export interface DashboardCharts {
  registrations: TimeSeriesPoint[]; // last 30 days
  activeUsers: TimeSeriesPoint[]; // last 30 days, distinct users seen that day
  reportsTrend: TimeSeriesPoint[]; // last 30 days
}
