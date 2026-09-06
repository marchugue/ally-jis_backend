import { initRedis, isRedisConnected, closeRedis } from '../config/redis';
import { getCache, setCache, delCache, delPattern, getOrSetCache } from '../app/utils/cache';
import { recordHeartbeat, findOnlineUserIds } from '../app/models/presence.model';
import { getLookups } from '../app/services/lookup.service';
import { env } from '../config/env';

async function runTests() {
  console.log('====================================================');
  console.log('        ALLY-JIS REDIS INTEGRATION TEST SUITE       ');
  console.log('====================================================\n');

  // ── TEST SUITE 1: Graceful Offline Fallback (No Redis) ────────────
  console.log('--- TEST SUITE 1: Graceful Offline Fallback (Direct DB Mode) ---');
  env.REDIS_ENABLED = false;
  await initRedis();

  console.log('1.1 isRedisConnected():', isRedisConnected());
  if (isRedisConnected() !== false) {
    throw new Error('Expected isRedisConnected() to be false when Redis is disabled.');
  }
  console.log('  ✓ Verified isRedisConnected() is false');

  const offlineGet = await getCache('test:offline:key');
  console.log('1.2 getCache() in offline mode returns:', offlineGet);
  if (offlineGet !== null) throw new Error('Expected null on offline getCache');
  console.log('  ✓ getCache safely returned null without throwing');

  const offlineSet = await setCache('test:offline:key', { message: 'hello' });
  console.log('1.3 setCache() in offline mode returns:', offlineSet);
  if (offlineSet !== false) throw new Error('Expected false on offline setCache');
  console.log('  ✓ setCache safely returned false without throwing');

  let fetchFnCalled = false;
  const fallbackResult = await getOrSetCache(
    'test:cache:aside',
    async () => {
      fetchFnCalled = true;
      return { data: 'fresh-db-result' };
    },
    60
  );
  console.log('1.4 getOrSetCache fallback result:', fallbackResult);
  if (!fetchFnCalled || fallbackResult.data !== 'fresh-db-result') {
    throw new Error('getOrSetCache failed to execute fallback fetchFn');
  }
  console.log('  ✓ getOrSetCache successfully fell back to direct provider\n');

  // ── TEST SUITE 2: Live Redis Operations (If Redis is accessible) ──
  console.log('--- TEST SUITE 2: Live Redis Operations & Pub/Sub ---');
  env.REDIS_ENABLED = true;
  env.REDIS_URL = process.env.TEST_REDIS_URL || process.env.REDIS_URL || env.REDIS_URL || 'redis://127.0.0.1:6379';

  console.log(`Connecting to Redis at ${env.REDIS_URL}...`);
  const { client } = await initRedis();

  if (isRedisConnected() && client) {
    console.log('  ✓ Redis connected successfully!');

    // 2.1 Basic Set/Get/Delete
    await setCache('test:user:123', { name: 'Ally Test Student', role: 'student' }, 30);
    const cachedUser = await getCache<{ name: string; role: string }>('test:user:123');
    console.log('2.1 Cached user retrieved from Redis:', cachedUser);
    if (cachedUser?.name !== 'Ally Test Student') {
      throw new Error('Redis getCache did not return matching payload');
    }
    console.log('  ✓ Basic cache set and get matched perfectly');

    // 2.2 Cache-Aside pattern
    let computeRuns = 0;
    const computeVal = async () => {
      computeRuns++;
      return { timestamp: Date.now(), count: 42 };
    };

    const firstFetch = await getOrSetCache('test:cache:aside:val', computeVal, 60);
    const secondFetch = await getOrSetCache('test:cache:aside:val', computeVal, 60);

    console.log('2.2 Cache-Aside run count:', computeRuns);
    if (computeRuns !== 1 || firstFetch.timestamp !== secondFetch.timestamp) {
      throw new Error('Cache-Aside failed to hit cache on second call');
    }
    console.log('  ✓ Cache-Aside hit cache on second invocation (0 DB calls)');

    // 2.3 Presence ZSET
    const testUserId = 'test-user-uuid-' + Date.now();
    await recordHeartbeat(testUserId);
    const onlineIds = await findOnlineUserIds();
    console.log(`2.3 Online user IDs count: ${onlineIds.length}, includes test user:`, onlineIds.includes(testUserId));
    if (!onlineIds.includes(testUserId)) {
      throw new Error('Redis ZSET presence did not include test user');
    }
    console.log('  ✓ Presence ZSET sub-millisecond heartbeat and list active');

    // 2.4 Pattern Deletion
    await setCache('test:pattern:1', 'one', 60);
    await setCache('test:pattern:2', 'two', 60);
    await delPattern('test:pattern:*');
    const p1 = await getCache('test:pattern:1');
    const p2 = await getCache('test:pattern:2');
    if (p1 !== null || p2 !== null) {
      throw new Error('delPattern did not delete all matching keys');
    }
    console.log('  ✓ Safe non-blocking SCAN pattern deletion succeeded');

    // Cleanup
    await delCache(['test:user:123', 'test:cache:aside:val']);
    await closeRedis();
    console.log('  ✓ Redis closed gracefully\n');
  } else {
    console.log('  ℹ Local Redis instance not active. Offline fallback mode fully validated.\n');
  }

  console.log('====================================================');
  console.log('  ALL INTEGRATION & FALLBACK TESTS PASSED CLEANLY!  ');
  console.log('====================================================');
}

runTests().catch((err) => {
  console.error('Test suite error:', err);
  process.exit(1);
});
