import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createCache, RedisNotConfiguredError } from './cache';

// Mock the redis module so no real connections are made.
const mockGet = vi.fn();
const mockSet = vi.fn();
const mockDel = vi.fn();
const mockOn = vi.fn();
const mockConnect = vi.fn();
const mockScanIterator = vi.fn();
const mockEval = vi.fn();
const mockZRem = vi.fn();

vi.mock('redis', () => ({
  createClient: vi.fn(() => ({
    get: mockGet,
    set: mockSet,
    del: mockDel,
    on: mockOn,
    connect: mockConnect,
    scanIterator: mockScanIterator,
    eval: mockEval,
    zRem: mockZRem,
    // The lazy client reuses its connection only while open; the real node-redis
    // client exposes this and it is true after a successful connect().
    isOpen: true,
  })),
}));

beforeEach(() => {
  vi.resetAllMocks();
});

describe('createCache', () => {
  it('returns an object with all expected methods', () => {
    const cache = createCache(() => 'redis://localhost:6379');

    expect(cache).toHaveProperty('getCached');
    expect(cache).toHaveProperty('setCache');
    expect(cache).toHaveProperty('setCacheIndefinitely');
    expect(cache).toHaveProperty('deleteCache');
    expect(cache).toHaveProperty('deleteCacheByPattern');
    expect(cache).toHaveProperty('resetCacheClient');
  });

  it('logs Redis client errors via the registered error handler', async () => {
    const cache = createCache(() => 'redis://localhost:6379');
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await cache.getCached('key');

    expect(mockOn).toHaveBeenCalledWith('error', expect.any(Function));
    const errorHandler = mockOn.mock.calls.find(([event]) => event === 'error')?.[1];
    const clientError = new Error('connection lost');
    errorHandler(clientError);

    expect(consoleSpy).toHaveBeenCalledWith('Redis Client Error', clientError);
    consoleSpy.mockRestore();
  });

  it('does not create a Redis client until first operation (lazy initialization)', async () => {
    const { createClient } = await import('redis');
    const cache = createCache(() => 'redis://localhost:6379');

    // Just creating the cache should not trigger createClient
    expect(createClient).not.toHaveBeenCalled();

    // Trigger an operation to force client creation
    await cache.getCached('some-key');
    expect(createClient).toHaveBeenCalledOnce();
  });

  it('reuses the client across multiple operations', async () => {
    const { createClient } = await import('redis');
    const cache = createCache(() => 'redis://localhost:6379');

    await cache.getCached('key-1');
    await cache.getCached('key-2');
    await cache.setCache('key-3', 'value');

    // createClient should only have been called once despite three operations
    expect(createClient).toHaveBeenCalledOnce();
  });

  it('throws RedisNotConfiguredError when getRedisUrl returns undefined (misconfig stays loud)', async () => {
    const cache = createCache(() => undefined);

    await expect(cache.getCached('key')).rejects.toThrow('REDIS_URL is not set');
    await expect(cache.getCached('key')).rejects.toBeInstanceOf(RedisNotConfiguredError);
  });
});

describe('bounded reconnect (TRI-49 AC3)', () => {
  it('configures a connect timeout and a reconnect strategy', async () => {
    const { createClient } = await import('redis');
    const cache = createCache(() => 'redis://localhost:6379');

    await cache.getCached('key');

    const options = vi.mocked(createClient).mock.calls[0]![0]!;
    expect(options.socket).toMatchObject({ connectTimeout: 3000 });
    expect(typeof (options.socket as { reconnectStrategy: unknown }).reconnectStrategy).toBe(
      'function',
    );
  });

  it('backs off while under the attempt cap and gives up at it', async () => {
    const { createClient } = await import('redis');
    const cache = createCache(() => 'redis://localhost:6379');

    await cache.getCached('key');

    const options = vi.mocked(createClient).mock.calls[0]![0]!;
    const reconnectStrategy = (
      options.socket as {
        reconnectStrategy: (retries: number, cause: Error) => number | Error | false;
      }
    ).reconnectStrategy;

    // Under the cap: a numeric backoff delay so node-redis retries.
    expect(typeof reconnectStrategy(0, new Error('x'))).toBe('number');
    expect(typeof reconnectStrategy(2, new Error('x'))).toBe('number');
    // At the cap (3): an Error so connect() rejects and callers fail fast
    // instead of the default forever-retry hanging startup.
    expect(reconnectStrategy(3, new Error('x'))).toBeInstanceOf(Error);
  });

  it('recreates the client on the next call once the previous one has closed', async () => {
    const { createClient } = await import('redis');
    // First call gets a client that reports closed (its bounded reconnect gave
    // up); the default mock client for the second call reports open.
    vi.mocked(createClient).mockReturnValueOnce({
      get: mockGet,
      set: mockSet,
      del: mockDel,
      on: mockOn,
      connect: mockConnect,
      scanIterator: mockScanIterator,
      eval: mockEval,
      zRem: mockZRem,
      isOpen: false,
    } as never);
    const cache = createCache(() => 'redis://localhost:6379');

    await cache.getCached('a'); // builds the closed client
    await cache.getCached('b'); // isOpen is false, so a fresh client is built

    expect(createClient).toHaveBeenCalledTimes(2);
  });

  it('fails open (not throw) when connect() rejects on a Redis outage', async () => {
    // The bounded reconnect makes connect() reject rather than hang. The fail-open
    // cache operations must translate that to a miss so direct consumers
    // (verifyGitHubRepositoryAccess) fall back to GitHub instead of throwing.
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockConnect.mockRejectedValue(new Error('Unable to connect to Redis after repeated attempts'));
    const cache = createCache(() => 'redis://localhost:6379');

    expect(await cache.getCached('a')).toBeNull();
    expect(await cache.setCache('a', 'v')).toBe(false);
    expect(await cache.setCacheIndefinitely('a', 'v')).toBe(false);
    expect(await cache.deleteCache('a')).toBe(false);
    expect(await cache.deleteCacheByPattern('a:*')).toBe(0);
    consoleSpy.mockRestore();
  });

  it('keeps getRateLimitClient() rejecting on a connect() failure (limiter fallback signal)', async () => {
    // The limiter must be able to tell Redis is down so it can fall back to
    // in-memory; unlike the cache ops, this does not fail open.
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockConnect.mockRejectedValue(new Error('Unable to connect to Redis after repeated attempts'));
    const cache = createCache(() => 'redis://localhost:6379');

    await expect(cache.getRateLimitClient()).rejects.toThrow('Unable to connect to Redis');
    consoleSpy.mockRestore();
  });

  it('rebuilds after a connect() rejection rather than caching the dead client', async () => {
    const { createClient } = await import('redis');
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // First connect rejects (outage) -> fail open to null, client never assigned.
    mockConnect.mockRejectedValueOnce(
      new Error('Unable to connect to Redis after repeated attempts'),
    );
    const cache = createCache(() => 'redis://localhost:6379');

    expect(await cache.getCached('a')).toBeNull();

    // The next call's connect succeeds, so a fresh client is built and used.
    mockGet.mockResolvedValue(null);
    await cache.getCached('b');
    expect(createClient).toHaveBeenCalledTimes(2);
    consoleSpy.mockRestore();
  });
});

describe('getRateLimitClient (TRI-49 shared client)', () => {
  it('returns the same connection the cache uses (one client per process)', async () => {
    const { createClient } = await import('redis');
    const cache = createCache(() => 'redis://localhost:6379');

    await cache.getCached('cache-key');
    const rateLimitClient = await cache.getRateLimitClient();

    // The limiter shares the cache's single connection, not a second one.
    expect(createClient).toHaveBeenCalledOnce();
    // Narrowed to the limiter's surface; the underlying client carries eval/zRem.
    expect(typeof rateLimitClient.eval).toBe('function');
    expect(typeof rateLimitClient.zRem).toBe('function');
  });

  it('throws when REDIS_URL is not set, so a host can fall back to in-memory (AC4)', async () => {
    const cache = createCache(() => undefined);

    await expect(cache.getRateLimitClient()).rejects.toThrow('REDIS_URL is not set');
  });
});

describe('getCached', () => {
  it('returns null when key does not exist', async () => {
    mockGet.mockResolvedValue(null);
    const cache = createCache(() => 'redis://localhost:6379');

    const result = await cache.getCached('nonexistent');

    expect(result).toBeNull();
    expect(mockGet).toHaveBeenCalledWith('nonexistent');
  });

  it('returns parsed JSON when key exists', async () => {
    const data = { name: 'test', count: 42 };
    mockGet.mockResolvedValue(JSON.stringify(data));
    const cache = createCache(() => 'redis://localhost:6379');

    const result = await cache.getCached('existing-key');

    expect(result).toEqual(data);
  });

  it('returns null on Redis error without throwing', async () => {
    mockGet.mockRejectedValue(new Error('Connection refused'));
    // Suppress console.error for this test
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const cache = createCache(() => 'redis://localhost:6379');

    const result = await cache.getCached('error-key');

    expect(result).toBeNull();
    consoleSpy.mockRestore();
  });
});

describe('setCache', () => {
  it('calls redis.set with JSON.stringify and EX option', async () => {
    mockSet.mockResolvedValue('OK');
    const cache = createCache(() => 'redis://localhost:6379');
    const value = { data: 'hello' };

    const result = await cache.setCache('my-key', value, 600);

    expect(result).toBe(true);
    expect(mockSet).toHaveBeenCalledWith('my-key', JSON.stringify(value), { EX: 600 });
  });

  it('uses default TTL of 3600 when not specified', async () => {
    mockSet.mockResolvedValue('OK');
    const cache = createCache(() => 'redis://localhost:6379');

    await cache.setCache('default-ttl-key', 'value');

    expect(mockSet).toHaveBeenCalledWith('default-ttl-key', JSON.stringify('value'), { EX: 3600 });
  });

  it('returns false on Redis error without throwing', async () => {
    mockSet.mockRejectedValue(new Error('Write failure'));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const cache = createCache(() => 'redis://localhost:6379');

    const result = await cache.setCache('fail-key', 'value');

    expect(result).toBe(false);
    consoleSpy.mockRestore();
  });
});

describe('setCacheIndefinitely', () => {
  it('calls redis.set without EX option', async () => {
    mockSet.mockResolvedValue('OK');
    const cache = createCache(() => 'redis://localhost:6379');
    const value = { permanent: true };

    const result = await cache.setCacheIndefinitely('permanent-key', value);

    expect(result).toBe(true);
    expect(mockSet).toHaveBeenCalledWith('permanent-key', JSON.stringify(value));
  });

  it('returns false on Redis error without throwing', async () => {
    mockSet.mockRejectedValue(new Error('Write failure'));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const cache = createCache(() => 'redis://localhost:6379');

    const result = await cache.setCacheIndefinitely('fail-key', 'value');

    expect(result).toBe(false);
    consoleSpy.mockRestore();
  });
});

describe('deleteCache', () => {
  it('calls redis.del with the key and returns true', async () => {
    mockDel.mockResolvedValue(1);
    const cache = createCache(() => 'redis://localhost:6379');

    const result = await cache.deleteCache('delete-me');

    expect(result).toBe(true);
    expect(mockDel).toHaveBeenCalledWith('delete-me');
  });

  it('returns false on Redis error without throwing', async () => {
    mockDel.mockRejectedValue(new Error('Delete failure'));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const cache = createCache(() => 'redis://localhost:6379');

    const result = await cache.deleteCache('fail-key');

    expect(result).toBe(false);
    consoleSpy.mockRestore();
  });
});

describe('deleteCacheByPattern', () => {
  it('uses scanIterator to find keys and deletes them in batch', async () => {
    // Simulate scanIterator yielding individual string keys
    mockScanIterator.mockReturnValue(
      (async function* () {
        yield 'cache:user:1';
        yield 'cache:user:2';
        yield 'cache:user:3';
      })(),
    );
    mockDel.mockResolvedValue(3);
    const cache = createCache(() => 'redis://localhost:6379');

    const count = await cache.deleteCacheByPattern('cache:user:*');

    expect(count).toBe(3);
    expect(mockScanIterator).toHaveBeenCalledWith({ MATCH: 'cache:user:*' });
    expect(mockDel).toHaveBeenCalledWith(['cache:user:1', 'cache:user:2', 'cache:user:3']);
  });

  it('returns 0 when no keys match the pattern', async () => {
    mockScanIterator.mockReturnValue(
      (async function* () {
        // empty iterator — no keys match
      })(),
    );
    const cache = createCache(() => 'redis://localhost:6379');

    const count = await cache.deleteCacheByPattern('nonexistent:*');

    expect(count).toBe(0);
    // del should not be called when there are no keys
    expect(mockDel).not.toHaveBeenCalled();
  });

  it('handles scanIterator returning array chunks', async () => {
    mockScanIterator.mockReturnValue(
      (async function* () {
        yield ['batch:1', 'batch:2'];
        yield 'batch:3';
      })(),
    );
    mockDel.mockResolvedValue(3);
    const cache = createCache(() => 'redis://localhost:6379');

    const count = await cache.deleteCacheByPattern('batch:*');

    expect(count).toBe(3);
    expect(mockDel).toHaveBeenCalledWith(['batch:1', 'batch:2', 'batch:3']);
  });

  it('skips falsy keys yielded by scanIterator', async () => {
    // scanIterator can yield empty/nullish values; the guard drops them so they
    // are never passed to del. (Covers a pre-existing branch, closed while
    // touching this file for TRI-49.)
    mockScanIterator.mockReturnValue(
      (async function* () {
        yield 'real:1';
        yield '';
        yield null;
      })(),
    );
    mockDel.mockResolvedValue(1);
    const cache = createCache(() => 'redis://localhost:6379');

    const count = await cache.deleteCacheByPattern('mixed:*');

    expect(count).toBe(1);
    expect(mockDel).toHaveBeenCalledWith(['real:1']);
  });

  it('returns 0 on Redis error without throwing', async () => {
    mockScanIterator.mockImplementation(() => {
      throw new Error('Scan failure');
    });
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const cache = createCache(() => 'redis://localhost:6379');

    const count = await cache.deleteCacheByPattern('fail:*');

    expect(count).toBe(0);
    consoleSpy.mockRestore();
  });
});

describe('resetCacheClient', () => {
  it('causes next operation to create a new client', async () => {
    const { createClient } = await import('redis');
    const cache = createCache(() => 'redis://localhost:6379');

    // First operation creates a client
    await cache.getCached('key');
    expect(createClient).toHaveBeenCalledOnce();

    // Reset forces a new client on next operation
    cache.resetCacheClient();
    await cache.getCached('key');
    expect(createClient).toHaveBeenCalledTimes(2);
  });
});
