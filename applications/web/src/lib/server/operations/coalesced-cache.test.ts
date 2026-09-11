import { describe, expect, it, vi } from 'vitest';
import { createCoalescedCache } from './coalesced-cache';

describe('createCoalescedCache', () => {
  it('returns a value younger than the TTL without calling load again', async () => {
    let now = 1_000;
    const load = vi.fn(async () => 'value');
    const cache = createCoalescedCache(load, 5_000, { clock: () => now });

    expect(await cache.get()).toBe('value');
    now = 4_999; // still within the 5s TTL
    expect(await cache.get()).toBe('value');
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('reloads once the TTL has elapsed', async () => {
    let now = 1_000;
    const load = vi.fn(async () => `value@${now}`);
    const cache = createCoalescedCache(load, 5_000, { clock: () => now });

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
    const cache = createCoalescedCache(load, 5_000, { clock: () => now });

    await cache.get();
    cache.reset();
    now = 1_001; // still within TTL, but the cache was cleared
    await cache.get();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('isolates callers: mutating a returned value does not corrupt later reads', async () => {
    const load = vi.fn(async () => ({ dependencies: ['database'] }));
    const cache = createCoalescedCache(load, 5_000);

    const first = await cache.get();
    first.dependencies.push('mutated');
    const second = await cache.get(); // cache hit, within TTL

    expect(second.dependencies).toEqual(['database']);
    expect(load).toHaveBeenCalledTimes(1); // still one probe; the hit was cloned
  });

  it('gives each coalesced caller its own clone of the in-flight result', async () => {
    let resolveLoad: (value: { dependencies: string[] }) => void = () => {};
    const load = vi.fn(
      () =>
        new Promise<{ dependencies: string[] }>((resolve) => {
          resolveLoad = resolve;
        }),
    );
    const cache = createCoalescedCache(load, 5_000);

    const first = cache.get();
    const second = cache.get();
    resolveLoad({ dependencies: ['database'] });
    const firstResult = await first;
    const secondResult = await second;
    firstResult.dependencies.push('mutated');

    expect(secondResult.dependencies).toEqual(['database']); // not corrupted by the other caller
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('abandons an in-flight load past inFlightTimeoutMs and re-loads on the next get', async () => {
    vi.useFakeTimers();
    try {
      const load = vi
        .fn<() => Promise<string>>()
        .mockReturnValueOnce(new Promise<string>(() => {})) // first: stalls forever
        .mockResolvedValueOnce('recovered'); // second: dependency has recovered
      const cache = createCoalescedCache(load, 5_000, { inFlightTimeoutMs: 4_000 });

      const first = cache.get();
      // Attach the rejection assertion before advancing timers so the promise is
      // never transiently unhandled when the deadline fires.
      const firstRejects = expect(first).rejects.toThrow(/deadline/);
      await vi.advanceTimersByTimeAsync(4_001);
      await firstRejects;

      // The in-flight entry cleared at the deadline, so the next get re-probes.
      expect(await cache.get()).toBe('recovered');
      expect(load).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not let an abandoned load overwrite a newer result (generation guard)', async () => {
    vi.useFakeTimers();
    try {
      let resolveFirst: (value: string) => void = () => {};
      const load = vi
        .fn<() => Promise<string>>()
        .mockReturnValueOnce(new Promise<string>((resolve) => (resolveFirst = resolve)))
        .mockResolvedValueOnce('fresh');
      const cache = createCoalescedCache(load, 5_000, { inFlightTimeoutMs: 4_000 });

      const first = cache.get();
      const firstRejects = expect(first).rejects.toThrow(/deadline/);
      await vi.advanceTimersByTimeAsync(4_001); // first load abandoned
      await firstRejects;

      expect(await cache.get()).toBe('fresh'); // a newer load caches 'fresh'

      // The abandoned first load resolves late — it must not overwrite 'fresh'.
      resolveFirst('stale');
      await vi.advanceTimersByTimeAsync(1); // flush the late resolution
      expect(await cache.get()).toBe('fresh');
      expect(load).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
