import { beforeEach, describe, expect, it, vi } from 'vitest';

const poolInstances: MockPool[] = [];
let nextConnectClient: MockPoolClient | undefined;

class MockPoolClient {
  readonly query = vi.fn();
  readonly release = vi.fn();
}

class MockPool {
  readonly connect = vi.fn(async () => {
    if (nextConnectClient === undefined) throw new Error('missing mock client');
    return nextConnectClient;
  });
  readonly end = vi.fn();
  readonly options: unknown;

  constructor(options: unknown) {
    this.options = options;
    poolInstances.push(this);
  }
}

vi.mock('@neondatabase/serverless', () => ({
  Pool: MockPool,
}));

const { createPostgresAdvisoryLock } = await import('./postgres-advisory-lock');

beforeEach(() => {
  vi.clearAllMocks();
  poolInstances.splice(0);
  nextConnectClient = new MockPoolClient();
});

describe('createPostgresAdvisoryLock', () => {
  it('acquires and releases the singleton advisory lock', async () => {
    nextConnectClient!.query
      .mockResolvedValueOnce({ rows: [{ acquired: true }] })
      .mockResolvedValueOnce({ rows: [{ released: true }] });

    const lock = createPostgresAdvisoryLock('postgres://user:pass@localhost:5432/tribunal');
    const lease = await lock.acquire();
    await lease.release();

    expect(poolInstances[0]?.options).toEqual({
      connectionString: 'postgres://user:pass@localhost:5432/tribunal',
      max: 1,
    });
    expect(nextConnectClient!.query).toHaveBeenNthCalledWith(
      1,
      'SELECT pg_try_advisory_lock(hashtext($1)) AS acquired',
      ['tribunal-engine-singleton'],
    );
    expect(nextConnectClient!.query).toHaveBeenNthCalledWith(
      2,
      'SELECT pg_advisory_unlock(hashtext($1)) AS released',
      ['tribunal-engine-singleton'],
    );
    expect(nextConnectClient!.release).toHaveBeenCalledTimes(1);
    expect(poolInstances[0]?.end).toHaveBeenCalledTimes(1);
  });

  it('releases the client and closes the pool when the lock stays held elsewhere', async () => {
    nextConnectClient!.query.mockResolvedValue({ rows: [{ acquired: false }] });

    const lock = createPostgresAdvisoryLock('postgres://user:pass@localhost:5432/tribunal', {
      attempts: 3,
      sleep: async () => {},
    });
    await expect(lock.acquire()).rejects.toThrow(
      'another Tribunal engine already holds the singleton advisory lock',
    );

    // Retries the configured number of times before conceding, then cleans up.
    expect(nextConnectClient!.query).toHaveBeenCalledTimes(3);
    expect(nextConnectClient!.release).toHaveBeenCalledTimes(3);
    expect(poolInstances[0]?.end).toHaveBeenCalledTimes(1);
  });

  it('retries and acquires once a predecessor releases the lock', async () => {
    nextConnectClient!.query
      .mockResolvedValueOnce({ rows: [{ acquired: false }] })
      .mockResolvedValueOnce({ rows: [{ acquired: true }] })
      .mockResolvedValueOnce({ rows: [{ released: true }] });

    const lock = createPostgresAdvisoryLock('postgres://user:pass@localhost:5432/tribunal', {
      attempts: 5,
      sleep: async () => {},
    });
    const lease = await lock.acquire();
    await lease.release();

    // Two try-lock attempts (fail, then succeed) plus the unlock on release.
    expect(nextConnectClient!.query).toHaveBeenNthCalledWith(
      1,
      'SELECT pg_try_advisory_lock(hashtext($1)) AS acquired',
      ['tribunal-engine-singleton'],
    );
    expect(nextConnectClient!.query).toHaveBeenNthCalledWith(
      2,
      'SELECT pg_try_advisory_lock(hashtext($1)) AS acquired',
      ['tribunal-engine-singleton'],
    );
    expect(poolInstances[0]?.end).toHaveBeenCalledTimes(1);
  });

  it('retries and closes the pool when the acquire query keeps failing', async () => {
    nextConnectClient!.query.mockRejectedValue(new Error('query failed'));

    const lock = createPostgresAdvisoryLock('postgres://user:pass@localhost:5432/tribunal', {
      attempts: 2,
      sleep: async () => {},
    });
    await expect(lock.acquire()).rejects.toThrow('query failed');

    expect(nextConnectClient!.query).toHaveBeenCalledTimes(2);
    // Each failed attempt must return its connection to the pool.
    expect(nextConnectClient!.release).toHaveBeenCalledTimes(2);
    expect(poolInstances[0]?.end).toHaveBeenCalledTimes(1);
  });

  it('waits between retries using the real default sleep when none is injected', async () => {
    // Kept tiny so the real wait stays fast in CI. The assertion floor below
    // is derived from this value rather than a second hardcoded number, so
    // the two can't drift out of sync.
    const delayMs = 20;
    // `setTimeout` is permitted to fire a hair early, so the floor is kept
    // below `delayMs` rather than equal to it — comfortably above
    // async/microtask noise while leaving margin against that slack.
    const minimumExpectedElapsedMs = delayMs / 2;

    nextConnectClient!.query
      .mockResolvedValueOnce({ rows: [{ acquired: false }] })
      .mockResolvedValueOnce({ rows: [{ acquired: true }] })
      .mockResolvedValueOnce({ rows: [{ released: true }] });

    // No `sleep` option — exercises the production `setTimeout`-based default.
    const lock = createPostgresAdvisoryLock('postgres://user:pass@localhost:5432/tribunal', {
      attempts: 2,
      delayMs,
    });

    const startedAt = performance.now();
    const lease = await lock.acquire();
    const elapsedMs = performance.now() - startedAt;
    await lease.release();

    // Proves the default sleep actually delayed the retry rather than spinning.
    expect(elapsedMs).toBeGreaterThanOrEqual(minimumExpectedElapsedMs);
    expect(nextConnectClient!.query).toHaveBeenCalledTimes(3);
  });

  it('still reports the lock as held elsewhere when the final attempt hits a transient error', async () => {
    // A rolling-deploy handoff can spend nearly its whole budget seeing
    // "held elsewhere" and then hit a one-off connection/query error on the
    // very last attempt. The exhaustion error must still be
    // HELD_ELSEWHERE_MESSAGE — not the transient error — so the caller's
    // retry wrapper keeps treating this as a retryable handoff instead of
    // misclassifying it as an unrelated fatal boot failure.
    nextConnectClient!.query
      .mockResolvedValueOnce({ rows: [{ acquired: false }] })
      .mockResolvedValueOnce({ rows: [{ acquired: false }] })
      .mockRejectedValueOnce(new Error('connection reset'));

    const lock = createPostgresAdvisoryLock('postgres://user:pass@localhost:5432/tribunal', {
      attempts: 3,
      sleep: async () => {},
    });

    await expect(lock.acquire()).rejects.toThrow(
      'another Tribunal engine already holds the singleton advisory lock',
    );
    expect(nextConnectClient!.query).toHaveBeenCalledTimes(3);
    expect(poolInstances[0]?.end).toHaveBeenCalledTimes(1);
  });

  it('fails fast on persistent transport failures instead of exhausting the full held-lock budget', async () => {
    // The long default acquire budget (~8.25 minutes) exists to survive a
    // real held-lock handoff. A connection/query failure is a different
    // failure class — bad credentials, a network partition, a Neon outage —
    // and must surface after a handful of consecutive failures, not after
    // grinding through the whole budget with the default sleep.
    nextConnectClient!.query.mockRejectedValue(new Error('connection refused'));

    const lock = createPostgresAdvisoryLock('postgres://user:pass@localhost:5432/tribunal', {
      // Deliberately omit `attempts` to exercise the real (large) default
      // budget — the fix under test is that transport failures do not
      // consume it.
      sleep: async () => {},
    });

    await expect(lock.acquire()).rejects.toThrow('connection refused');

    // Three consecutive transport failures, not the full 100-attempt budget.
    expect(nextConnectClient!.query).toHaveBeenCalledTimes(3);
    expect(nextConnectClient!.release).toHaveBeenCalledTimes(3);
    expect(poolInstances[0]?.end).toHaveBeenCalledTimes(1);
  });

  it('resets the consecutive-transport-failure count on a successful held-elsewhere probe', async () => {
    // A handoff that is mostly "held elsewhere" with occasional transient
    // hiccups sprinkled in must not trip the fail-fast transport guard —
    // only a run of consecutive failures should.
    nextConnectClient!.query
      .mockRejectedValueOnce(new Error('blip 1'))
      .mockRejectedValueOnce(new Error('blip 2'))
      .mockResolvedValueOnce({ rows: [{ acquired: false }] })
      .mockRejectedValueOnce(new Error('blip 3'))
      .mockRejectedValueOnce(new Error('blip 4'))
      .mockResolvedValueOnce({ rows: [{ acquired: true }] })
      .mockResolvedValueOnce({ rows: [{ released: true }] });

    const lock = createPostgresAdvisoryLock('postgres://user:pass@localhost:5432/tribunal', {
      attempts: 10,
      sleep: async () => {},
    });

    const lease = await lock.acquire();
    await lease.release();

    expect(nextConnectClient!.query).toHaveBeenCalledTimes(7);
  });

  describe('pooled-endpoint detection', () => {
    it('logs an error at construction when the connection host is a Neon pooled endpoint', () => {
      const logger = { error: vi.fn() };

      createPostgresAdvisoryLock(
        'postgres://user:pass@ep-cool-cell-12345-pooler.us-east-2.aws.neon.tech/tribunal',
        { logger },
      );

      expect(logger.error).toHaveBeenCalledTimes(1);
      expect(logger.error.mock.calls[0]?.[0]).toContain('UNRELIABLE');
      expect(logger.error.mock.calls[0]?.[0]).toContain('ENGINE_SINGLETON_DATABASE_URL');
    });

    it('stays silent at construction when the connection host is a direct endpoint', () => {
      const logger = { error: vi.fn() };

      createPostgresAdvisoryLock(
        'postgres://user:pass@ep-cool-cell-12345.us-east-2.aws.neon.tech/tribunal',
        { logger },
      );

      expect(logger.error).not.toHaveBeenCalled();
    });

    it('never throws when the connection string cannot be parsed as a URL', () => {
      const logger = { error: vi.fn() };

      expect(() =>
        createPostgresAdvisoryLock('not-a-valid-connection-string', { logger }),
      ).not.toThrow();
      expect(logger.error).not.toHaveBeenCalled();
    });
  });

  describe('release() unlock verification', () => {
    it('logs an explicit error when pg_advisory_unlock returns false', async () => {
      nextConnectClient!.query
        .mockResolvedValueOnce({ rows: [{ acquired: true }] })
        .mockResolvedValueOnce({ rows: [{ released: false }] });
      const logger = { error: vi.fn() };

      const lock = createPostgresAdvisoryLock('postgres://user:pass@localhost:5432/tribunal', {
        logger,
      });
      const lease = await lock.acquire();
      await lease.release();

      expect(logger.error).toHaveBeenCalledTimes(1);
      expect(logger.error.mock.calls[0]?.[0]).toContain('NOT');
      expect(logger.error.mock.calls[0]?.[0]).toContain('released');
    });

    it('does not log an error when pg_advisory_unlock returns true', async () => {
      nextConnectClient!.query
        .mockResolvedValueOnce({ rows: [{ acquired: true }] })
        .mockResolvedValueOnce({ rows: [{ released: true }] });
      const logger = { error: vi.fn() };

      const lock = createPostgresAdvisoryLock('postgres://user:pass@localhost:5432/tribunal', {
        logger,
      });
      const lease = await lock.acquire();
      await lease.release();

      expect(logger.error).not.toHaveBeenCalled();
    });
  });
});
