import { createClient, type RedisClientType } from 'redis';

type RedisClient = RedisClientType;

/**
 * The Redis operations the MCP rate limiter needs, and nothing more. The
 * library's store factories accept a structural `{ eval, zRem }` client
 * (`MinimalRedisClient`), which the node-redis client satisfies.
 *
 * Narrowing the exposed surface to this (TRI-49 AC2) does two honest things: it
 * keeps `.get`/`.set` off the accessor so a caller cannot *accidentally* cache
 * GitHub responses around `cachedRead` through it, and — more importantly for a
 * shared connection — it keeps `subscribe`/blocking commands off, which is what
 * would actually break the connection the GitHub cache also uses. It is not an
 * ironclad guarantee: `eval` runs arbitrary Lua (so a `SET` is reachable), and a
 * cast can widen the type. The real bypass guard for GitHub caching remains the
 * `cachedRead` contract and its lint rule (.claude/rules/github-api.md); this
 * type is intent-signaling and connection-safety, not a substitute for it. See
 * documentation/decisions.md (2026-09-11).
 */
export type RateLimitRedisClient = Pick<RedisClientType, 'eval' | 'zRem'>;

/**
 * Bound the reconnect attempts so a `connect()` against an unreachable Redis
 * fails fast instead of retrying forever and hanging startup — the whole point
 * of TRI-49 AC3. Matches the reference in Protokit's redis-client.ts.
 */
const MAX_RECONNECT_ATTEMPTS = 3;
const CONNECT_TIMEOUT_MILLISECONDS = 3000;

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
    // Reuse the client only while it is open. A client whose bounded reconnect
    // gave up (below) is closed, and every command on it would throw
    // ClientClosedError; recreating it on the next call lets a transient outage
    // recover without a process restart, mirroring Protokit's lazy client.
    if (client?.isOpen) return client;

    const newClient = createClient({
      url,
      socket: {
        connectTimeout: CONNECT_TIMEOUT_MILLISECONDS,
        // node-redis's default strategy retries forever, so `connect()` would
        // never reject while Redis is unreachable and startup would hang. Give
        // up after a few attempts so `connect()` rejects and callers fail fast;
        // the `isOpen` check above recreates the client on a later call.
        reconnectStrategy: (retries) =>
          retries >= MAX_RECONNECT_ATTEMPTS
            ? new Error('Unable to connect to Redis after repeated attempts')
            : Math.min(retries * 100, 1000),
      },
    });
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

  /**
   * The shared, connected Redis client, narrowed to the rate limiter's surface.
   * TRI-49 decided Tribunal runs one Redis client per process: the web process
   * hands this same client to the MCP rate-limiter store factories (TRI-56)
   * rather than opening a second connection. GitHub caching (`github-*` keys)
   * and the limiter (`tribunal-mcp:*` keys) share one connection over disjoint
   * keyspaces. Returned narrowed to {@link RateLimitRedisClient} — see that type
   * for what the narrowing does and does not guarantee (AC2).
   */
  async function getRateLimitClient(): Promise<RateLimitRedisClient> {
    return getRedisClient();
  }

  return {
    getCached,
    setCache,
    setCacheIndefinitely,
    deleteCache,
    deleteCacheByPattern,
    resetCacheClient,
    getRateLimitClient,
  };
}
