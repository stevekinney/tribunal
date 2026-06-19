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
      .mockResolvedValueOnce({ rows: [] });

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
      'SELECT pg_advisory_unlock(hashtext($1))',
      ['tribunal-engine-singleton'],
    );
    expect(nextConnectClient!.release).toHaveBeenCalledTimes(1);
    expect(poolInstances[0]?.end).toHaveBeenCalledTimes(1);
  });

  it('releases the client and closes the pool when the lock is held elsewhere', async () => {
    nextConnectClient!.query.mockResolvedValueOnce({ rows: [{ acquired: false }] });

    const lock = createPostgresAdvisoryLock('postgres://user:pass@localhost:5432/tribunal');
    await expect(lock.acquire()).rejects.toThrow(
      'another Tribunal engine already holds the singleton advisory lock',
    );

    expect(nextConnectClient!.release).toHaveBeenCalledTimes(1);
    expect(poolInstances[0]?.end).toHaveBeenCalledTimes(1);
  });

  it('releases the client and closes the pool when the acquire query fails', async () => {
    nextConnectClient!.query.mockRejectedValueOnce(new Error('query failed'));

    const lock = createPostgresAdvisoryLock('postgres://user:pass@localhost:5432/tribunal');
    await expect(lock.acquire()).rejects.toThrow('query failed');

    expect(nextConnectClient!.release).toHaveBeenCalledTimes(1);
    expect(poolInstances[0]?.end).toHaveBeenCalledTimes(1);
  });
});
