import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SWEEP_INTERVAL_SECONDS,
  MAX_SWEEP_INTERVAL_SECONDS,
  resolveInstanceId,
  resolveSweepIntervalMs,
  startOauthCleanupSweep,
} from './cleanup-scheduler';

/**
 * TRI-51: the web process runs an in-process periodic sweep that purges expired
 * OAuth rows through the library's `purgeExpired` primitives. These cover the
 * deterministic pieces — the interval cap (AC2), the purge fan-out (AC1), and the
 * Fly-not-Railway instance identity (AC5); the production-scale purge (AC4) lives
 * in the `test:mcp:cleanup` database suite.
 */

afterEach(() => {
  vi.restoreAllMocks();
});

describe('resolveSweepIntervalMs', () => {
  it('clamps a value above the 32-bit setInterval ceiling so it cannot overflow and fire immediately (AC2)', () => {
    // One second over the cap, and a value large enough to wrap a signed 32-bit
    // millisecond argument, both clamp to the cap rather than overflowing.
    expect(resolveSweepIntervalMs(MAX_SWEEP_INTERVAL_SECONDS + 1)).toBe(
      MAX_SWEEP_INTERVAL_SECONDS * 1000,
    );
    expect(resolveSweepIntervalMs(Number.MAX_SAFE_INTEGER)).toBe(MAX_SWEEP_INTERVAL_SECONDS * 1000);
    // The cap, expressed in ms, is within the signed 32-bit range setInterval accepts.
    expect(MAX_SWEEP_INTERVAL_SECONDS * 1000).toBeLessThanOrEqual(2 ** 31 - 1);
  });

  it('accepts an in-range value verbatim and floors a fractional one', () => {
    expect(resolveSweepIntervalMs(120)).toBe(120_000);
    expect(resolveSweepIntervalMs(120.9)).toBe(120_000);
  });

  it('falls back to the default for an unset, non-finite, or non-positive value', () => {
    const defaultMs = DEFAULT_SWEEP_INTERVAL_SECONDS * 1000;
    expect(resolveSweepIntervalMs(undefined)).toBe(defaultMs);
    expect(resolveSweepIntervalMs(Number.NaN)).toBe(defaultMs);
    expect(resolveSweepIntervalMs(Number.POSITIVE_INFINITY)).toBe(defaultMs);
    expect(resolveSweepIntervalMs(0)).toBe(defaultMs);
    expect(resolveSweepIntervalMs(-5)).toBe(defaultMs);
  });

  it('clamps a sub-second positive value up to the one-second floor', () => {
    expect(resolveSweepIntervalMs(0.5)).toBe(1_000);
  });
});

describe('resolveInstanceId', () => {
  it('prefers FLY_ALLOC_ID, then FLY_MACHINE_ID (AC5)', () => {
    expect(resolveInstanceId({ FLY_ALLOC_ID: 'alloc-1', FLY_MACHINE_ID: 'machine-1' })).toBe(
      'alloc-1',
    );
    expect(resolveInstanceId({ FLY_MACHINE_ID: 'machine-1' })).toBe('machine-1');
  });

  it('falls back to a fixed label and never consults Railway variables (AC5)', () => {
    // Protokit derived identity from Railway; Tribunal runs on Fly and must not.
    expect(
      resolveInstanceId({
        RAILWAY_REPLICA_ID: 'railway-replica',
        RAILWAY_SERVICE_ID: 'railway-service',
      }),
    ).toBe('unknown-instance');
  });
});

describe('startOauthCleanupSweep', () => {
  function createStores() {
    return {
      transactions: { purgeExpired: vi.fn().mockResolvedValue(0) },
      codes: { purgeExpired: vi.fn().mockResolvedValue(0) },
      tokens: { purgeExpired: vi.fn().mockResolvedValue(0) },
    };
  }

  it('purges transactions, codes, and tokens on each interval tick with the current time (AC1)', async () => {
    vi.useFakeTimers();
    try {
      const stores = createStores();
      const now = new Date('2026-09-01T00:00:00.000Z');
      const sweep = startOauthCleanupSweep({
        stores: stores as never,
        intervalMs: 60_000,
        now: () => now,
      });

      expect(stores.transactions.purgeExpired).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(60_000);

      expect(stores.transactions.purgeExpired).toHaveBeenCalledWith(now);
      expect(stores.codes.purgeExpired).toHaveBeenCalledWith(now);
      expect(stores.tokens.purgeExpired).toHaveBeenCalledWith(now);

      await vi.advanceTimersByTimeAsync(60_000);
      expect(stores.tokens.purgeExpired).toHaveBeenCalledTimes(2);

      sweep.stop();
      await vi.advanceTimersByTimeAsync(120_000);
      // No further ticks after stop().
      expect(stores.tokens.purgeExpired).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports a sweep failure through onError and keeps the interval alive for the next tick', async () => {
    vi.useFakeTimers();
    try {
      const stores = createStores();
      stores.transactions.purgeExpired
        .mockRejectedValueOnce(new Error('database unavailable'))
        .mockResolvedValue(0);
      const onError = vi.fn();
      const sweep = startOauthCleanupSweep({
        stores: stores as never,
        intervalMs: 60_000,
        onError,
      });

      await vi.advanceTimersByTimeAsync(60_000);
      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);

      // The interval survived the rejection: the next tick runs and succeeds.
      await vi.advanceTimersByTimeAsync(60_000);
      expect(stores.transactions.purgeExpired).toHaveBeenCalledTimes(2);
      expect(onError).toHaveBeenCalledTimes(1);

      sweep.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('defaults onError to console.error so a failure is never silently swallowed', async () => {
    vi.useFakeTimers();
    try {
      const stores = createStores();
      stores.codes.purgeExpired.mockRejectedValueOnce(new Error('boom'));
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const sweep = startOauthCleanupSweep({ stores: stores as never, intervalMs: 60_000 });

      await vi.advanceTimersByTimeAsync(60_000);
      expect(consoleSpy).toHaveBeenCalled();

      sweep.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('defaults now to the wall clock, passing a Date to each purge', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-01T12:00:00.000Z'));
    try {
      const stores = createStores();
      const sweep = startOauthCleanupSweep({ stores: stores as never, intervalMs: 1_000 });

      await vi.advanceTimersByTimeAsync(1_000);
      const passed = stores.transactions.purgeExpired.mock.calls[0][0];
      expect(passed).toBeInstanceOf(Date);

      sweep.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
