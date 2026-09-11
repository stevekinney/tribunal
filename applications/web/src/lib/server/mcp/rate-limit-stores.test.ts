import { afterEach, describe, expect, it, vi } from 'vitest';

const mockEnv = vi.hoisted(() => ({
  REDIS_URL: undefined as string | undefined,
  NODE_ENV: 'test' as string,
  MCP_ENABLED: undefined as string | undefined,
}));
const mockRateLimitClient = vi.hoisted(() => ({ eval: vi.fn(), zRem: vi.fn() }));

vi.mock('$env/dynamic/private', () => ({ env: mockEnv }));
vi.mock('$lib/server/redis', () => ({
  getRateLimitClient: vi.fn(async () => mockRateLimitClient),
}));
vi.mock('@lostgradient/mcp/rate-limit', () => ({
  createInMemorySlidingWindowStore: vi.fn(() => ({ kind: 'in-memory-sliding' })),
  createInMemoryConcurrencySlotStore: vi.fn(() => ({ kind: 'in-memory-concurrency' })),
  createRedisSlidingWindowStore: vi.fn((client: unknown) => ({ kind: 'redis-sliding', client })),
  createRedisConcurrencySlotStore: vi.fn((client: unknown) => ({
    kind: 'redis-concurrency',
    client,
  })),
}));

import { createRateLimitStores, rateLimitingIsRedisBacked } from './rate-limit-stores';

afterEach(() => {
  mockEnv.REDIS_URL = undefined;
  mockEnv.NODE_ENV = 'test';
  mockEnv.MCP_ENABLED = undefined;
  vi.clearAllMocks();
});

describe('rateLimitingIsRedisBacked', () => {
  it('reflects whether REDIS_URL is set', () => {
    expect(rateLimitingIsRedisBacked()).toBe(false);
    mockEnv.REDIS_URL = 'redis://localhost:6379';
    expect(rateLimitingIsRedisBacked()).toBe(true);
  });
});

describe('createRateLimitStores', () => {
  it('uses in-memory stores in local dev without REDIS_URL', () => {
    const stores = createRateLimitStores();
    expect((stores.slidingWindow as { kind: string }).kind).toBe('in-memory-sliding');
    expect((stores.concurrencySlots as { kind: string }).kind).toBe('in-memory-concurrency');
  });

  it('uses Redis-backed stores over the shared client when REDIS_URL is set', () => {
    mockEnv.REDIS_URL = 'redis://localhost:6379';
    const stores = createRateLimitStores();
    expect((stores.slidingWindow as { kind: string }).kind).toBe('redis-sliding');
    expect((stores.concurrencySlots as { kind: string }).kind).toBe('redis-concurrency');
  });

  it('refuses in-memory stores when the MCP surface is enabled in production', () => {
    mockEnv.NODE_ENV = 'production';
    mockEnv.MCP_ENABLED = 'true';
    expect(() => createRateLimitStores()).toThrow(/without REDIS_URL/);
  });

  it('still uses in-memory in production when the MCP surface is disabled', () => {
    mockEnv.NODE_ENV = 'production';
    mockEnv.MCP_ENABLED = 'false';
    expect((createRateLimitStores().slidingWindow as { kind: string }).kind).toBe(
      'in-memory-sliding',
    );
  });
});

describe('the shared-client proxy', () => {
  type ProxyClient = {
    eval: (s: string, o: unknown) => Promise<unknown>;
    zRem: (key: string, member: string) => Promise<number>;
  };
  function proxyFromRedisStore(): ProxyClient {
    mockEnv.REDIS_URL = 'redis://localhost:6379';
    const stores = createRateLimitStores();
    return (stores.slidingWindow as { client: ProxyClient }).client;
  }

  it('forwards eval to the re-acquired shared client per call', async () => {
    mockRateLimitClient.eval.mockResolvedValue('result');
    const proxy = proxyFromRedisStore();
    const options = { keys: ['k'], arguments: ['a'] };
    await expect(proxy.eval('script', options)).resolves.toBe('result');
    expect(mockRateLimitClient.eval).toHaveBeenCalledWith('script', options);
  });

  it('logs loudly and re-throws on a store error (fail closed)', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockRateLimitClient.eval.mockRejectedValueOnce(new Error('redis down'));
    const proxy = proxyFromRedisStore();
    await expect(proxy.eval('script', { keys: [], arguments: [] })).rejects.toThrow('redis down');
    expect(consoleSpy).toHaveBeenCalledWith(
      'MCP rate-limiter Redis error (failing closed):',
      expect.any(Error),
    );
    consoleSpy.mockRestore();
  });

  it('forwards zRem to the shared client and re-throws on error', async () => {
    mockRateLimitClient.zRem.mockResolvedValue(1);
    const proxy = proxyFromRedisStore();
    await expect(proxy.zRem('key', 'member')).resolves.toBe(1);
    expect(mockRateLimitClient.zRem).toHaveBeenCalledWith('key', 'member');

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockRateLimitClient.zRem.mockRejectedValueOnce(new Error('redis down'));
    await expect(proxy.zRem('key', 'member')).rejects.toThrow('redis down');
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
