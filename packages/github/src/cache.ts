import { createClient } from 'redis';

type RedisClient = ReturnType<typeof createClient>;

/**
 * Creates an environment-agnostic Redis cache interface.
 *
 * Each call returns an independent singleton — the Redis client is created lazily
 * on first use and reused for subsequent operations.
 *
 * @param getRedisUrl - Thunk that returns the Redis connection URL from the
 *   host environment (e.g. `$env/dynamic/private` in SvelteKit, `process.env`
 *   in Node workers).
 */
export function createCache(getRedisUrl: () => string | undefined) {
  let client: RedisClient | null = null;

  async function getRedisClient(): Promise<RedisClient> {
    const url = getRedisUrl();
    if (!url) throw new Error('REDIS_URL is not set');
    if (client) return client;

    const newClient = createClient({ url });
    newClient.on('error', (err) => console.error('Redis Client Error', err));
    await newClient.connect();
    client = newClient;
    return client;
  }

  async function getCached<T>(key: string): Promise<T | null> {
    const redis = await getRedisClient();

    try {
      const cached = await redis.get(key);

      if (cached) {
        return JSON.parse(cached) as T;
      }
    } catch (e) {
      console.error('Redis get error:', e);
    }

    return null;
  }

  async function setCache<T>(key: string, value: T, ttlSeconds: number = 3600): Promise<boolean> {
    const redis = await getRedisClient();

    try {
      await redis.set(key, JSON.stringify(value), { EX: ttlSeconds });
      return true;
    } catch (e) {
      console.error('Redis set error:', e);
      return false;
    }
  }

  async function setCacheIndefinitely<T>(key: string, value: T): Promise<boolean> {
    const redis = await getRedisClient();

    try {
      await redis.set(key, JSON.stringify(value));
      return true;
    } catch (e) {
      console.error('Redis set error:', e);
      return false;
    }
  }

  async function deleteCache(key: string): Promise<boolean> {
    const redis = await getRedisClient();

    try {
      await redis.del(key);
      return true;
    } catch (e) {
      console.error('Redis delete error:', e);
      return false;
    }
  }

  async function deleteCacheByPattern(pattern: string): Promise<number> {
    const redis = await getRedisClient();

    try {
      const keys: string[] = [];
      for await (const key of redis.scanIterator({ MATCH: pattern })) {
        if (key) {
          // scanIterator can return string or string[] depending on mode
          if (Array.isArray(key)) {
            keys.push(...key);
          } else {
            keys.push(key);
          }
        }
      }

      // Delete in batch if we have keys (del requires at least one argument)
      if (keys.length > 0) {
        await redis.del(keys);
      }

      return keys.length;
    } catch (e) {
      console.error('Redis delete by pattern error:', e);
      return 0;
    }
  }

  function resetCacheClient(): void {
    client = null;
  }

  return {
    getCached,
    setCache,
    setCacheIndefinitely,
    deleteCache,
    deleteCacheByPattern,
    resetCacheClient,
  };
}
