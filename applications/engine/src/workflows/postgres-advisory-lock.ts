import { Pool, type PoolClient } from '@neondatabase/serverless';
import type { EngineSingletonLease, EngineSingletonLock } from './bootstrap';

const lockKey = 'tribunal-engine-singleton';
export const HELD_ELSEWHERE_MESSAGE =
  'another Tribunal engine already holds the singleton advisory lock';

/**
 * Tuning for advisory-lock acquisition retries. On a rolling deploy the outgoing
 * engine releases this lock in `runtime.release()`, which runs strictly after
 * the Weft engine's `asyncDispose()` completes (see `bootstrap.ts`) — so the
 * advisory lock lags the prompt Weft-lease release from #146, it does not track
 * it. That release path is itself bounded by `kill_timeout = 20s`
 * (`deployment/fly/engine.toml`): if it does not finish in time, Fly SIGKILLs
 * the outgoing machine, the Postgres session dies uncleanly, and the advisory
 * lock is only freed once Neon reaps the dead session — a delay this process
 * does not control and that is not bounded by `kill_timeout` at all.
 *
 * Production run 29780778638 (see #169) measured that tail directly: the
 * incoming engine did not win the lock until ~7 minutes after the deploy
 * began. A 30s retry budget (the previous default) cannot span that, so the
 * old behavior was to exhaust the budget, throw, and let the process exit —
 * which Fly Machines turns into a full VM reboot that discards all retry
 * progress and restarts the clock. Two such reboots is exactly what stretched
 * the observed handoff past flyctl's ~5 minute health-check window.
 *
 * The fix is two-part: this budget is sized to comfortably clear both the
 * clean `kill_timeout` path and the observed SIGKILL/reap tail in a single
 * continuous wait (no process exit in between — see `index.ts`), and a wider
 * per-attempt delay keeps the retry from hammering Neon over that window.
 * The delay only runs between attempts, so the total wait is
 * `(attempts - 1) * delayMs` ≈ 8.25 minutes, not `attempts * delayMs`
 * (≈8.33 minutes) — the loop returns or throws on the final attempt without
 * sleeping again.
 */
const DEFAULT_ACQUIRE_ATTEMPTS = 100;
const DEFAULT_ACQUIRE_DELAY_MS = 5_000;

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
  const delayMs =
    Number.isFinite(options.delayMs) && (options.delayMs ?? -1) >= 0
      ? (options.delayMs as number)
      : DEFAULT_ACQUIRE_DELAY_MS;
  const sleep =
    options.sleep ??
    ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));

  return {
    async acquire() {
      let lastError: unknown = new Error(HELD_ELSEWHERE_MESSAGE);
      // Tracks whether the lock was observed held elsewhere on ANY attempt in
      // this cycle, not just the last one. A rolling-deploy handoff can spend
      // nearly the whole budget seeing "held elsewhere" and then hit a single
      // transient connection/query error on the final attempt; without this,
      // `lastError` would be that transient error, and the caller's retry
      // wrapper (`index.ts`) would misclassify a normal, still-retryable
      // handoff as an unrelated fatal boot failure and give up immediately.
      let sawHeldElsewhere = false;

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
          sawHeldElsewhere = true;
          lastError = new Error(HELD_ELSEWHERE_MESSAGE);
        } catch (error) {
          client?.release();
          lastError = error;
        }

        // A throwing custom sleep must not skip pool cleanup below; treat a
        // failed delay as "no delay" and continue to the next attempt.
        if (attempt < attempts) {
          try {
            await sleep(delayMs);
          } catch {
            // ignore — proceed to the next attempt immediately
          }
        }
      }

      await pool.end();
      // Prefer the canonical "held elsewhere" error over whatever the final
      // attempt happened to throw, as long as the cycle saw the lock held
      // elsewhere at least once — that is the signal the retry wrapper needs
      // to keep retrying instead of treating this as a distinct, fatal
      // failure class.
      if (sawHeldElsewhere) throw new Error(HELD_ELSEWHERE_MESSAGE);
      throw lastError instanceof Error ? lastError : new Error(String(lastError));
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
