import { supabaseAdmin } from '../../config/supabase';
import { getRedisClient, isRedisConnected } from '../../config/redis';

const ONLINE_WINDOW_SECONDS = 60;
const PRESENCE_KEY = 'presence:online';
const PRESENCE_GAME_KEY = 'presence:game:online';
const PRESENCE_WEB_KEY = 'presence:web:online';
const PRESENCE_APP_KEY = 'presence:app:online';

// In-memory fallback maps for platform presence when Redis is offline
const inMemoryPresence = new Map<string, { timestamp: number; platform: string }>();
const inMemoryGamePresence = new Map<string, number>();
const inMemoryWebPresence = new Map<string, number>();
const inMemoryAppPresence = new Map<string, number>();

export function normalizePlatform(platform?: string): 'web' | 'game' | 'app' {
  if (!platform) return 'web';
  const p = platform.toLowerCase().trim();
  if (p === 'game' || p === 'games') return 'game';
  if (p === 'app' || p === 'mobile' || p === 'react-native' || p === 'expo') return 'app';
  return 'web';
}

/**
 * POST /presence/heartbeat
 * Records user activity timestamp in Redis ZSET across all platforms.
 * When Redis is available, updates in-memory immediately and schedules background DB sync.
 * When Redis is offline, falls back directly to in-memory maps and PostgreSQL user_presence table.
 */
export async function recordHeartbeat(userId: string, platform?: string): Promise<void> {
  const now = Date.now();
  const normalized = normalizePlatform(platform);
  const client = getRedisClient();

  // Always keep in-memory fallback up to date
  inMemoryPresence.set(userId, { timestamp: now, platform: normalized });
  if (normalized === 'game') {
    inMemoryGamePresence.set(userId, now);
  } else if (normalized === 'app') {
    inMemoryAppPresence.set(userId, now);
  } else {
    inMemoryWebPresence.set(userId, now);
  }

  if (client && isRedisConnected()) {
    try {
      // Add to overall online pool
      await client.zadd(PRESENCE_KEY, now, userId);

      // Add to platform-specific pool
      if (normalized === 'game') {
        await client.zadd(PRESENCE_GAME_KEY, now, userId);
      } else if (normalized === 'app') {
        await client.zadd(PRESENCE_APP_KEY, now, userId);
      } else {
        await client.zadd(PRESENCE_WEB_KEY, now, userId);
      }

      // Best-effort non-blocking sync to PostgreSQL for admin dashboard history
      Promise.resolve(
        supabaseAdmin
          .from('user_presence')
          .upsert({ user_id: userId, last_seen_at: new Date(now).toISOString() }, { onConflict: 'user_id' })
      ).catch(() => {});
      return;
    } catch (err) {
      console.warn('[Presence] Redis heartbeat error, falling back to DB:', (err as Error).message);
    }
  }

  // Database fallback
  try {
    const { error } = await supabaseAdmin
      .from('user_presence')
      .upsert({ user_id: userId, last_seen_at: new Date().toISOString() }, { onConflict: 'user_id' });

    if (error) {
      console.warn('[Presence] Database heartbeat upsert warning:', error.message);
    }
  } catch (err: any) {
    console.warn('[Presence] Database fallback error:', err?.message || err);
  }
}

/**
 * Mark a user offline immediately across all platform pools.
 */
export async function recordOffline(userId: string): Promise<void> {
  inMemoryPresence.delete(userId);
  inMemoryGamePresence.delete(userId);
  inMemoryWebPresence.delete(userId);
  inMemoryAppPresence.delete(userId);

  const client = getRedisClient();
  if (client && isRedisConnected()) {
    try {
      await Promise.all([
        client.zrem(PRESENCE_KEY, userId),
        client.zrem(PRESENCE_GAME_KEY, userId),
        client.zrem(PRESENCE_WEB_KEY, userId),
        client.zrem(PRESENCE_APP_KEY, userId),
      ]);
    } catch (err) {
      console.warn('[Presence] Redis offline update error:', (err as Error).message);
    }
  }
}

/**
 * Check if a user is currently online.
 */
export async function isUserOnline(userId: string): Promise<boolean> {
  const now = Date.now();
  const cutoffMs = now - ONLINE_WINDOW_SECONDS * 1000;
  const client = getRedisClient();

  if (client && isRedisConnected()) {
    try {
      const score = await client.zscore(PRESENCE_KEY, userId);
      if (score !== null && Number(score) >= cutoffMs) {
        return true;
      }
    } catch {}
  }

  const mem = inMemoryPresence.get(userId);
  if (mem && mem.timestamp >= cutoffMs) {
    return true;
  }

  return false;
}

/**
 * GET /presence/online
 * Returns user IDs with a heartbeat in the last 60 seconds across all platforms.
 */
export async function findOnlineUserIds(): Promise<string[]> {
  const now = Date.now();
  const cutoffMs = now - ONLINE_WINDOW_SECONDS * 1000;
  const client = getRedisClient();

  let rawUserIds: string[] = [];

  if (client && isRedisConnected()) {
    try {
      client.zremrangebyscore(PRESENCE_KEY, '-inf', cutoffMs).catch(() => {});
      rawUserIds = await client.zrangebyscore(PRESENCE_KEY, cutoffMs, '+inf');
    } catch (err) {
      console.warn('[Presence] Redis online check error, falling back to DB:', (err as Error).message);
    }
  }

  // Check in-memory fallback
  if (rawUserIds.length === 0 && inMemoryPresence.size > 0) {
    for (const [userId, entry] of inMemoryPresence.entries()) {
      if (entry.timestamp >= cutoffMs) {
        rawUserIds.push(userId);
      } else {
        inMemoryPresence.delete(userId);
      }
    }
  }

  if (rawUserIds.length === 0) {
    // Database fallback
    const cutoff = new Date(cutoffMs).toISOString();
    const { data, error } = await supabaseAdmin
      .from('user_presence')
      .select('user_id')
      .gte('last_seen_at', cutoff);

    if (error) throw error;
    rawUserIds = (data ?? []).map((row) => row.user_id as string);
  }

  if (rawUserIds.length === 0) {
    return [];
  }

  return filterHiddenOnlineUsers(rawUserIds);
}

/**
 * Returns active user IDs specifically on the Game Portal in the last 60 seconds.
 */
export async function findGameOnlineUserIds(): Promise<string[]> {
  return findPlatformOnlineUserIds(PRESENCE_GAME_KEY, inMemoryGamePresence);
}

/**
 * Returns active user IDs on Web platform in the last 60 seconds.
 */
export async function findWebOnlineUserIds(): Promise<string[]> {
  return findPlatformOnlineUserIds(PRESENCE_WEB_KEY, inMemoryWebPresence);
}

/**
 * Returns active user IDs on Mobile App platform in the last 60 seconds.
 */
export async function findAppOnlineUserIds(): Promise<string[]> {
  return findPlatformOnlineUserIds(PRESENCE_APP_KEY, inMemoryAppPresence);
}

async function findPlatformOnlineUserIds(
  redisKey: string,
  inMemMap: Map<string, number>,
): Promise<string[]> {
  const now = Date.now();
  const cutoffMs = now - ONLINE_WINDOW_SECONDS * 1000;
  const client = getRedisClient();

  let rawUserIds: string[] = [];

  if (client && isRedisConnected()) {
    try {
      client.zremrangebyscore(redisKey, '-inf', cutoffMs).catch(() => {});
      rawUserIds = await client.zrangebyscore(redisKey, cutoffMs, '+inf');
    } catch (err) {
      console.warn(`[Presence] Redis platform check error (${redisKey}):`, (err as Error).message);
    }
  }

  // Check in-memory fallback
  if (rawUserIds.length === 0 && inMemMap.size > 0) {
    for (const [userId, timestamp] of inMemMap.entries()) {
      if (timestamp >= cutoffMs) {
        rawUserIds.push(userId);
      } else {
        inMemMap.delete(userId);
      }
    }
  }

  if (rawUserIds.length === 0) {
    return [];
  }

  return filterHiddenOnlineUsers(rawUserIds);
}

async function filterHiddenOnlineUsers(userIds: string[]): Promise<string[]> {
  try {
    const { data: hiddenRows } = await supabaseAdmin
      .from('user_preferences')
      .select('user_id')
      .in('user_id', userIds)
      .eq('show_online_status', false);

    if (hiddenRows && hiddenRows.length > 0) {
      const hiddenSet = new Set(hiddenRows.map((r) => r.user_id));
      return userIds.filter((id) => !hiddenSet.has(id));
    }
  } catch {
    // Non-blocking fallback
  }

  return userIds;
}
