export interface PresenceEntry {
  user_id: string;
  last_seen: string;
}

export interface OnlineUsersResponse {
  userIds: string[];
  online?: PresenceEntry[];
}
