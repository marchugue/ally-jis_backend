export interface NotificationFromUser {
  id: string;
  avatar_url?: string | null;
  full_name?: string | null;
  username?: string | null;
}

export interface NotificationRow {
  id: string;
  user_id: string;
  type: string;
  title: string;
  description?: string | null;
  is_read: boolean;
  from_user_id?: string | null;
  created_at: string;
  from_user?: NotificationFromUser | NotificationFromUser[] | null;
}
