export interface PresenceEntry {
  user_id: string;
  last_seen: string;
  platform?: string;
}

export interface OnlineUsersResponse {
  userIds: string[];
  gameUserIds?: string[];
  gameCount?: number;
  online?: PresenceEntry[];
}
