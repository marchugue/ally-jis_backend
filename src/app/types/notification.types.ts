export interface NotificationFromUser {
  id: string;
  avatar_url?: string | null;
  full_name?: string | null;
  username?: string | null;
}

export type NotificationEntityType =
  | 'post'
  | 'comment'
  | 'reply'
  | 'conversation'
  | 'profile'
  | 'requests'
  | 'discover';

export interface NotificationRedirectionTree {
  postId: string | null;
  parentId: string | null;
  childId: string | null;
  highlightId: string | null;
}

export interface NotificationRedirection {
  entityType: NotificationEntityType;
  targetId: string;
  route: string;
  params?: Record<string, string>;
  webUrl: string;
  postId?: string | null;
  parentId?: string | null;
  childId?: string | null;
  tree?: NotificationRedirectionTree;
}

export interface NotificationRedirectionResponse {
  notificationId: string;
  type: string;
  entityType: NotificationEntityType;
  targetId: string;
  webUrl: string;
  route: string;
  params: Record<string, string>;
  tree: NotificationRedirectionTree;
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
  parent_id?: string | null;
  child_id?: string | null;
  created_at: string;
  from_user?: NotificationFromUser | NotificationFromUser[] | null;
  redirection?: NotificationRedirection | null;
}
