import { describe, expect, it, vi } from 'vitest';
import { createCoalescedCache } from './coalesced-cache';

describe('createCoalescedCache', () => {
  it('returns a value younger than the TTL without calling load again', async () => {
    let now = 1_000;
    const load = vi.fn(async () => 'value');
    const cache = createCoalescedCache(load, 5_000, () => now);

    expect(await cache.get()).toBe('value');
    now = 4_999; // still within the 5s TTL
    expect(await cache.get()).toBe('value');
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('reloads once the TTL has elapsed', async () => {
    let now = 1_000;
    const load = vi.fn(async () => `value@${now}`);
    const cache = createCoalescedCache(load, 5_000, () => now);

    expect(await cache.get()).toBe('value@1000');
    now = 6_001; // past expiry (1000 + 5000)
    expect(await cache.get()).toBe('value@6001');
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('coalesces concurrent callers onto one in-flight load', async () => {
    let resolveLoad: (value: string) => void = () => {};
    const load = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveLoad = resolve;
        }),
    );
    const cache = createCoalescedCache(load, 5_000);

    const first = cache.get();
    const second = cache.get();
    resolveLoad('shared');

    expect(await first).toBe('shared');
    expect(await second).toBe('shared');
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('reload after a failed load is possible (in-flight is cleared)', async () => {
    const load = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce('recovered');
    const cache = createCoalescedCache(load, 5_000);

    await expect(cache.get()).rejects.toThrow('boom');
    expect(await cache.get()).toBe('recovered');
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('reset() forces the next get to reload', async () => {
    let now = 1_000;
    const load = vi.fn(async () => 'value');
    const cache = createCoalescedCache(load, 5_000, () => now);

    await cache.get();
    cache.reset();
    now = 1_001; // still within TTL, but the cache was cleared
    await cache.get();
    expect(load).toHaveBeenCalledTimes(2);
  });
});
