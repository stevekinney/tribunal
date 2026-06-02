import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createCache } from './cache';

// Mock the redis module so no real connections are made.
const mockGet = vi.fn();
const mockSet = vi.fn();
const mockDel = vi.fn();
const mockOn = vi.fn();
const mockConnect = vi.fn();
const mockScanIterator = vi.fn();

vi.mock('redis', () => ({
  createClient: vi.fn(() => ({
    get: mockGet,
    set: mockSet,
    del: mockDel,
    on: mockOn,
    connect: mockConnect,
    scanIterator: mockScanIterator,
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

  it('throws when getRedisUrl returns undefined', async () => {
    const cache = createCache(() => undefined);

    await expect(cache.getCached('key')).rejects.toThrow('REDIS_URL is not set');
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
