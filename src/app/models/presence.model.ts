import { supabaseAdmin } from '../../config/supabase';
import { getRedisClient, isRedisConnected } from '../../config/redis';

const ONLINE_WINDOW_SECONDS = 60;
const PRESENCE_KEY = 'presence:online';

/**
 * POST /presence/heartbeat
 * Records user activity timestamp in Redis ZSET (O(log(N)) in memory).
 * When Redis is available, updates in-memory immediately and schedules background DB sync.
 * When Redis is offline, falls back directly to PostgreSQL user_presence table.
 */
export async function recordHeartbeat(userId: string): Promise<void> {
  const now = Date.now();
  const client = getRedisClient();

  if (client && isRedisConnected()) {
    try {
      await client.zadd(PRESENCE_KEY, now, userId);
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

  if (client && isRedisConnected()) {
    try {
      // Asynchronously prune expired entries older than the cutoff
      client.zremrangebyscore(PRESENCE_KEY, '-inf', cutoffMs).catch(() => {});
      // Return active user IDs within the time window
      const activeIds = await client.zrangebyscore(PRESENCE_KEY, cutoffMs, '+inf');
      return activeIds;
    } catch (err) {
      console.warn('[Presence] Redis online check error, falling back to DB:', (err as Error).message);
    }
  }

  // Database fallback
  const cutoff = new Date(cutoffMs).toISOString();
  const { data, error } = await supabaseAdmin
    .from('user_presence')
    .select('user_id')
    .gte('last_seen_at', cutoff);

  if (error) throw error;
  return (data ?? []).map((row) => row.user_id as string);
}
