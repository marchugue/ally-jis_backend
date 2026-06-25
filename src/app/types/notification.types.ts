export interface NotificationRow {
  id: string;
  user_id: string;
  type: 'friend_request' | 'accepted' | 'message' | 'match' | string;
  title: string;
  description?: string | null;
  is_read: boolean;
  from_user_id?: string | null;
  created_at: string;
}
