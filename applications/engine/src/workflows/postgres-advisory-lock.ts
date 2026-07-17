import { Pool, type PoolClient } from '@neondatabase/serverless';
import type { EngineSingletonLease, EngineSingletonLock } from './bootstrap';

const lockKey = 'tribunal-engine-singleton';
const HELD_ELSEWHERE_MESSAGE = 'another Tribunal engine already holds the singleton advisory lock';

/**
 * Tuning for advisory-lock acquisition retries. On a rolling deploy the outgoing
 * engine's session lock on Neon is not always released the instant the new
 * engine starts — the predecessor's connection can take a few seconds to drop.
 * `pg_try_advisory_lock` is a hard, no-wait acquire, so without retries the new
 * engine crashes on startup and the deploy fails. Retrying bounds the wait to
 * roughly `attempts * delayMs` (~30s by default), comparable to Weft's own
 * lease wait, before giving up.
 */
const DEFAULT_ACQUIRE_ATTEMPTS = 10;
const DEFAULT_ACQUIRE_DELAY_MS = 3_000;

export type PostgresAdvisoryLockOptions = {
  attempts?: number;
  delayMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
};

export function createPostgresAdvisoryLock(
  connectionString: string,
  options: PostgresAdvisoryLockOptions = {},
): EngineSingletonLock {
  const pool = new Pool({ connectionString, max: 1 });
  const attempts =
    Number.isFinite(options.attempts) && (options.attempts ?? 0) >= 1
      ? Math.floor(options.attempts as number)
      : DEFAULT_ACQUIRE_ATTEMPTS;
  const delayMs = options.delayMs ?? DEFAULT_ACQUIRE_DELAY_MS;
  const sleep =
    options.sleep ??
    ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));

  return {
    async acquire() {
      let lastError: unknown = new Error(HELD_ELSEWHERE_MESSAGE);

      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        let client: PoolClient | undefined;
        try {
          client = await pool.connect();
          const result = await client.query<{ acquired: boolean }>(
            `SELECT pg_try_advisory_lock(hashtext($1)) AS acquired`,
            [lockKey],
          );
          if (result.rows[0]?.acquired === true) {
            return new PostgresAdvisoryLease(pool, client);
          }
          // Held elsewhere: return the connection to the pool and retry — a
          // predecessor engine's lock during a rolling deploy usually clears
          // within a few seconds of its connection dropping.
          client.release();
          lastError = new Error(HELD_ELSEWHERE_MESSAGE);
        } catch (error) {
          client?.release();
          lastError = error;
        }

        if (attempt < attempts) await sleep(delayMs);
      }

      await pool.end();
      throw lastError;
    },
  };
}

class PostgresAdvisoryLease implements EngineSingletonLease {
  constructor(
    private readonly pool: Pool,
    private readonly client: PoolClient,
  ) {}

  async release(): Promise<void> {
    try {
      await this.client.query(`SELECT pg_advisory_unlock(hashtext($1))`, [lockKey]);
    } finally {
      this.client.release();
      await this.pool.end();
    }
  }
}
