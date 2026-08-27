// src/app/types/adminUsers.types.ts

export interface AdminUserListItem {
  id: string;
  username: string | null;
  full_name: string | null;
  email: string;
  avatar_url: string | null;
  department: string | null;
  course: string | null;
  year_level: string | null;
  role: string;
  is_banned: boolean;
  is_suspended: boolean;
  suspended_until: string | null;
  admin_verified: boolean;
  created_at: string;
  last_seen_at: string | null;
}

export interface ListUsersParams {
  search?: string;
  status?: 'all' | 'active' | 'banned' | 'suspended';
  department?: string;
  sortBy?: 'created_at' | 'full_name' | 'username' | 'last_seen_at';
  sortDir?: 'asc' | 'desc';
  cursor?: string | null;
  limit?: number;
}

export interface PaginatedUserList {
  items: AdminUserListItem[];
  nextCursor: string | null;
  total: number;
}

export interface AdminUserDetail extends AdminUserListItem {
  bio: string | null;
  interests: string[];
  organizations: string[];
  postsCount: number;
  reportsAgainstCount: number;
  banned_at: string | null;
}
