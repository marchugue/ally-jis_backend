export interface NotificationFromUser {
  id: string;
  avatar_url?: string | null;
  full_name?: string | null;
  username?: string | null;
}

export type NotificationEntityType =
  | 'post'
  | 'comment'
  | 'conversation'
  | 'profile'
  | 'requests'
  | 'discover';

export interface NotificationRedirection {
  entityType: NotificationEntityType;
  targetId: string;
  route: string;
  params?: Record<string, string>;
  webUrl?: string;
}

export interface NotificationRow {
  id: string;
  user_id: string;
  type: string;
  title: string;
  description?: string | null;
  is_read: boolean;
  from_user_id?: string | null;
  target_id?: string | null;
  post_id?: string | null;
  comment_id?: string | null;
  created_at: string;
  from_user?: NotificationFromUser | NotificationFromUser[] | null;
  redirection?: NotificationRedirection | null;
}
