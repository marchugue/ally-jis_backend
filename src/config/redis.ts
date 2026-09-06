import Redis, { RedisOptions } from 'ioredis';
import { env } from './env';

let redisClient: Redis | null = null;
let redisSubClient: Redis | null = null;
let isRedisAvailable = false;
let hasLoggedFailure = false;

function createClientOptions(): RedisOptions {
  return {
    lazyConnect: true,
    maxRetriesPerRequest: 2,
    enableOfflineQueue: false, // Prevents commands from queuing indefinitely when Redis is down
    connectTimeout: 5000,
    retryStrategy(times) {
      if (times > 5) {
        if (!hasLoggedFailure) {
          console.warn('[Redis] Unable to reconnect after 5 attempts. Operating in database-direct mode.');
          hasLoggedFailure = true;
        }
        return 10000; // Keep retry interval at 10s without crashing process
      }
      return Math.min(times * 500, 3000);
    },
  };
}

/**
 * Initializes Redis primary and subscriber clients if REDIS_URL is configured.
 * Safely catches connection errors so backend continues running seamlessly without Redis.
 */
export async function initRedis(): Promise<{ client: Redis | null; subClient: Redis | null }> {
  if (!env.REDIS_ENABLED || !env.REDIS_URL) {
    console.info('[Redis] REDIS_URL not configured. Redis caching and pub/sub disabled (direct DB mode).');
    return { client: null, subClient: null };
  }

  try {
    const options = createClientOptions();
    redisClient = new Redis(env.REDIS_URL, options);
    redisSubClient = new Redis(env.REDIS_URL, options);

    redisClient.on('connect', () => {
      isRedisAvailable = true;
      hasLoggedFailure = false;
      console.info('[Redis] Primary client connected successfully.');
    });

    redisClient.on('ready', () => {
      isRedisAvailable = true;
    });

    redisClient.on('error', (err) => {
      isRedisAvailable = false;
      if (!hasLoggedFailure) {
        console.warn(`[Redis] Connection warning: ${err.message}. Gracefully falling back to DB.`);
        hasLoggedFailure = true;
      }
    });

    redisClient.on('close', () => {
      isRedisAvailable = false;
    });

    redisSubClient.on('error', (_err) => {
      // Subscriber error logged quietly
    });

    // Attempt initial connect with timeout
    await Promise.allSettled([
      redisClient.connect().catch((err) => {
        isRedisAvailable = false;
        console.warn(`[Redis] Initial primary connection failed: ${err.message}. Direct DB fallback active.`);
      }),
      redisSubClient.connect().catch(() => {
        // Sub-client failure handled silently
      }),
    ]);

    return { client: redisClient, subClient: redisSubClient };
  } catch (err: any) {
    isRedisAvailable = false;
    console.warn(`[Redis] Failed to initialize Redis: ${err?.message || err}. Direct DB fallback active.`);
    return { client: null, subClient: null };
  }
}

/**
 * Returns whether Redis is currently connected and ready to serve commands.
 */
export function isRedisConnected(): boolean {
  return isRedisAvailable && redisClient?.status === 'ready';
}

/**
 * Returns primary Redis client instance, or null if not initialized/connected.
 */
export function getRedisClient(): Redis | null {
  return isRedisConnected() ? redisClient : null;
}

/**
 * Returns Redis subscriber client instance, or null if not initialized/connected.
 */
export function getRedisSubClient(): Redis | null {
  return redisSubClient && (redisSubClient.status === 'ready' || redisSubClient.status === 'connect')
    ? redisSubClient
    : null;
}

/**
 * Closes Redis connections during graceful server shutdown.
 */
export async function closeRedis(): Promise<void> {
  try {
    if (redisClient) {
      await redisClient.quit();
    }
    if (redisSubClient) {
      await redisSubClient.quit();
    }
  } catch {
    // Ignore shutdown errors
  }
}
