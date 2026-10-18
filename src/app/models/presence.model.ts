import { supabaseAdmin } from '../../config/supabase';
import { getRedisClient, isRedisConnected } from '../../config/redis';

const ONLINE_WINDOW_SECONDS = 60;
const PRESENCE_KEY = 'presence:online';
const PRESENCE_GAME_KEY = 'presence:game:online';

// In-memory fallback map for game-specific presence when Redis is offline
const inMemoryGamePresence = new Map<string, number>();

/**
 * POST /presence/heartbeat
 * Records user activity timestamp in Redis ZSET (O(log(N)) in memory).
 * When Redis is available, updates in-memory immediately and schedules background DB sync.
 * When Redis is offline, falls back directly to PostgreSQL user_presence table.
 */
export async function recordHeartbeat(userId: string, platform?: string): Promise<void> {
  const now = Date.now();
  const client = getRedisClient();

  if (platform === 'game') {
    inMemoryGamePresence.set(userId, now);
  }

  if (client && isRedisConnected()) {
    try {
      await client.zadd(PRESENCE_KEY, now, userId);

      if (platform === 'game') {
        await client.zadd(PRESENCE_GAME_KEY, now, userId);
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
  const { error } = await supabaseAdmin
    .from('user_presence')
    .upsert({ user_id: userId, last_seen_at: new Date().toISOString() }, { onConflict: 'user_id' });

  if (error) throw error;
}

/**
 * GET /presence/online
 * Returns user IDs with a heartbeat in the last 60 seconds.
 * Queries Redis ZSET with zrangebyscore (< 1ms).
 * Falls back to PostgreSQL table scan if Redis is unavailable.
 */
export async function findOnlineUserIds(): Promise<string[]> {
  const now = Date.now();
  const cutoffMs = now - ONLINE_WINDOW_SECONDS * 1000;
  const client = getRedisClient();

  let rawUserIds: string[] = [];

  if (client && isRedisConnected()) {
    try {
      // Asynchronously prune expired entries older than the cutoff
      client.zremrangebyscore(PRESENCE_KEY, '-inf', cutoffMs).catch(() => {});
      // Return active user IDs within the time window
      rawUserIds = await client.zrangebyscore(PRESENCE_KEY, cutoffMs, '+inf');
    } catch (err) {
      console.warn('[Presence] Redis online check error, falling back to DB:', (err as Error).message);
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

  // Filter out users who disabled show_online_status
  try {
    const { data: hiddenRows } = await supabaseAdmin
      .from('user_preferences')
      .select('user_id')
      .in('user_id', rawUserIds)
      .eq('show_online_status', false);

    if (hiddenRows && hiddenRows.length > 0) {
      const hiddenSet = new Set(hiddenRows.map((r) => r.user_id));
      return rawUserIds.filter((id) => !hiddenSet.has(id));
    }
  } catch (err) {
    // Non-blocking fallback
  }

  return rawUserIds;
}

/**
 * Returns active user IDs specifically on the Game Portal in the last 60 seconds.
 */
export async function findGameOnlineUserIds(): Promise<string[]> {
  const now = Date.now();
  const cutoffMs = now - ONLINE_WINDOW_SECONDS * 1000;
  const client = getRedisClient();

  let rawGameUserIds: string[] = [];

  if (client && isRedisConnected()) {
    try {
      client.zremrangebyscore(PRESENCE_GAME_KEY, '-inf', cutoffMs).catch(() => {});
      rawGameUserIds = await client.zrangebyscore(PRESENCE_GAME_KEY, cutoffMs, '+inf');
    } catch (err) {
      console.warn('[Presence] Redis game online check error:', (err as Error).message);
    }
  }

  // Check in-memory fallback
  if (rawGameUserIds.length === 0 && inMemoryGamePresence.size > 0) {
    for (const [userId, timestamp] of inMemoryGamePresence.entries()) {
      if (timestamp >= cutoffMs) {
        rawGameUserIds.push(userId);
      } else {
        inMemoryGamePresence.delete(userId);
      }
    }
  }

  if (rawGameUserIds.length === 0) {
    return [];
  }

  // Filter out users who disabled show_online_status
  try {
    const { data: hiddenRows } = await supabaseAdmin
      .from('user_preferences')
      .select('user_id')
      .in('user_id', rawGameUserIds)
      .eq('show_online_status', false);

    if (hiddenRows && hiddenRows.length > 0) {
      const hiddenSet = new Set(hiddenRows.map((r) => r.user_id));
      return rawGameUserIds.filter((id) => !hiddenSet.has(id));
    }
  } catch {}

  return rawGameUserIds;
}
