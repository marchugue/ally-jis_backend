export type PlatformType = 'web' | 'game' | 'app' | string;

export interface PresenceEntry {
  user_id: string;
  last_seen: string;
  platform?: PlatformType;
}

export interface OnlineUsersResponse {
  userIds: string[];
  gameUserIds?: string[];
  gameCount?: number;
  webUserIds?: string[];
  webCount?: number;
  appUserIds?: string[];
  appCount?: number;
  online?: PresenceEntry[];
}

export interface PresenceEventPayload {
  userId: string;
  platform?: PlatformType;
  status: 'online' | 'offline';
  timestamp: string;
}

export interface PresenceWebhookPayload {
  event?: 'presence:online' | 'presence:offline' | 'heartbeat' | 'presence:change';
  type?: 'INSERT' | 'UPDATE' | 'DELETE';
  table?: string;
  schema?: string;
  record?: {
    user_id?: string;
    last_seen_at?: string;
    platform?: string;
  };
  old_record?: any;
  userId?: string;
  platform?: PlatformType;
  status?: 'online' | 'offline';
  events?: Array<{
    userId: string;
    platform?: PlatformType;
    status: 'online' | 'offline';
  }>;
}
