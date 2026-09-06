import { getRedisClient, isRedisConnected } from '../../config/redis';

/**
 * Safely fetches and JSON-parses a cached value by key.
 * Returns null if Redis is unavailable or on cache miss.
 */
export async function getCache<T>(key: string): Promise<T | null> {
  const client = getRedisClient();
  if (!client) return null;

  try {
    const raw = await client.get(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch (err) {
    console.warn(`[Cache] getCache error for key "${key}":`, (err as Error).message);
    return null;
  }
}

/**
 * Safely writes a JSON-stringified value to Redis with an optional TTL (in seconds).
 * Returns true if written successfully, false otherwise.
 */
export async function setCache(key: string, value: unknown, ttlSeconds?: number): Promise<boolean> {
  const client = getRedisClient();
  if (!client) return false;

  try {
    const serialized = JSON.stringify(value);
    if (ttlSeconds && ttlSeconds > 0) {
      await client.set(key, serialized, 'EX', ttlSeconds);
    } else {
      await client.set(key, serialized);
    }
    return true;
  } catch (err) {
    console.warn(`[Cache] setCache error for key "${key}":`, (err as Error).message);
    return false;
  }
}

/**
 * Safely deletes one or more keys from Redis.
 */
export async function delCache(keyOrKeys: string | string[]): Promise<boolean> {
  const client = getRedisClient();
  if (!client) return false;

  try {
    const keys = Array.isArray(keyOrKeys) ? keyOrKeys : [keyOrKeys];
    if (keys.length === 0) return true;
    await client.del(...keys);
    return true;
  } catch (err) {
    console.warn(`[Cache] delCache error:`, (err as Error).message);
    return false;
  }
}

/**
 * Deletes keys matching a wildcard pattern using SCAN to avoid blocking Redis.
 * Example: delPattern('cache:user:flags:*')
 */
export async function delPattern(pattern: string): Promise<boolean> {
  const client = getRedisClient();
  if (!client) return false;

  try {
    const stream = client.scanStream({
      match: pattern,
      count: 100,
    });

    const pipeline = client.pipeline();
    let hasKeys = false;

    await new Promise<void>((resolve, reject) => {
      stream.on('data', (keys: string[]) => {
        if (keys && keys.length > 0) {
          hasKeys = true;
          for (const key of keys) {
            pipeline.del(key);
          }
        }
      });
      stream.on('end', () => resolve());
      stream.on('error', (err) => reject(err));
    });

    if (hasKeys) {
      await pipeline.exec();
    }
    return true;
  } catch (err) {
    console.warn(`[Cache] delPattern error for pattern "${pattern}":`, (err as Error).message);
    return false;
  }
}

/**
 * Cache-Aside Helper: Attempts to retrieve from cache.
 * On miss or when Redis is offline, calls `fetchFn()`, caches the result if possible, and returns it.
 */
export async function getOrSetCache<T>(
  key: string,
  fetchFn: () => Promise<T>,
  ttlSeconds: number
): Promise<T> {
  if (isRedisConnected()) {
    const cached = await getCache<T>(key);
    if (cached !== null && cached !== undefined) {
      return cached;
    }
  }

  const fresh = await fetchFn();

  if (isRedisConnected() && fresh !== null && fresh !== undefined) {
    // Non-blocking set
    setCache(key, fresh, ttlSeconds).catch(() => {});
  }

  return fresh;
}
