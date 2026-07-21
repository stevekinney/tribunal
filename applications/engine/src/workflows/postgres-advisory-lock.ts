import { Pool, type PoolClient } from '@neondatabase/serverless';
import type { EngineSingletonLease, EngineSingletonLock } from './bootstrap';

const lockKey = 'tribunal-engine-singleton';
export const HELD_ELSEWHERE_MESSAGE =
  'another Tribunal engine already holds the singleton advisory lock';

/**
 * Tuning for advisory-lock acquisition retries.
 *
 * CORRECTED (2026-07-20): the delay this budget exists to survive is NOT the
 * SIGKILL/Neon-reap path this comment previously attributed it to. Production
 * evidence contradicts that hypothesis directly — engine logs from 2026-07-21
 * show a clean, sub-second SIGTERM shutdown with zero release errors logged
 * (`00:19:25 shutdown complete`, no SIGKILL in between), yet the advisory lock
 * was still reported held 8 minutes later (`00:27:50 singleton advisory lock
 * still held after acquire cycle 1/5`). A dead session being reaped by Neon
 * would not produce a clean shutdown log with no release failure.
 *
 * The real cause is that the lock is (by default) acquired over a connection
 * to Neon's POOLED endpoint (PgBouncer in transaction pooling mode), while
 * `pg_try_advisory_lock`/`pg_advisory_unlock` are SESSION-level: the lock is
 * tied to the Postgres backend, not the client connection. Under transaction
 * pooling, PgBouncer hands a backend to a client only for the duration of one
 * transaction and then returns it to the pool — so the backend that acquired
 * the lock is not guaranteed to be the same backend a later `unlock` call
 * lands on. The unlock can silently return `false` on the wrong backend while
 * the lock stays held on the original one, and it is only freed when
 * PgBouncer eventually reaps that server connection — an uncontrolled delay
 * of minutes, not the `kill_timeout` window. See `ENGINE_SINGLETON_DATABASE_URL`
 * below and in `index.ts`/`environment.ts` for the fix: run the lock over a
 * direct, unpooled connection where session semantics hold.
 *
 * This retry budget stays generous regardless, because a real rolling-deploy
 * handoff (predecessor still shutting down, or running without the direct URL
 * provisioned yet) can still take a while to clear. Production run 29780778638
 * (see #169) measured a ~7 minute tail before this fix; a 30s retry budget
 * (the previous default) cannot span that, so the old behavior was to exhaust
 * the budget, throw, and let the process exit — which Fly Machines turns into
 * a full VM reboot that discards all retry progress and restarts the clock.
 * Two such reboots is exactly what stretched the observed handoff past
 * flyctl's ~5 minute health-check window.
 *
 * The fix is two-part: this budget is sized to comfortably clear a slow
 * handoff in a single continuous wait (no process exit in between — see
 * `index.ts`), and a wider per-attempt delay keeps the retry from hammering
 * Neon over that window. The delay only runs between attempts, so the total
 * wait is `(attempts - 1) * delayMs` ≈ 8.25 minutes, not `attempts * delayMs`
 * (≈8.33 minutes) — the loop returns or throws on the final attempt without
 * sleeping again.
 */
const DEFAULT_ACQUIRE_ATTEMPTS = 100;
const DEFAULT_ACQUIRE_DELAY_MS = 5_000;

/**
 * The long acquire budget above exists to survive a real held-lock handoff —
 * it should not also apply to a connection/query failure (bad credentials, a
 * network partition, a Neon outage), which is a different failure class that
 * should surface quickly rather than grinding through ~8.25 minutes of
 * retries. This caps how many *consecutive* transport/query failures are
 * tolerated before giving up early; it resets on every successful query
 * (whether the lock was acquired or seen held elsewhere), so a handoff that
 * is mostly "held elsewhere" with an occasional transient hiccup is
 * unaffected — only a run of failures in a row trips it.
 */
const MAX_CONSECUTIVE_TRANSPORT_FAILURES = 3;

export type PostgresAdvisoryLockOptions = {
  attempts?: number;
  delayMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
  logger?: Pick<Console, 'error'>;
};

/**
 * Neon pooled endpoints put `-pooler.` in the hostname (versus the direct
 * hostname, which omits it). Session-level advisory locks are unsound over
 * such an endpoint — see the module header comment above. Returns `false`
 * (never throws) when the connection string cannot be parsed as a URL, since
 * this check is purely advisory logging and must never block lock use.
 */
export function isPooledNeonEndpoint(connectionString: string): boolean {
  try {
    return new URL(connectionString).hostname.includes('-pooler.');
  } catch {
    return false;
  }
}

export function createPostgresAdvisoryLock(
  connectionString: string,
  options: PostgresAdvisoryLockOptions = {},
): EngineSingletonLock {
  const logger = options.logger ?? console;
  if (isPooledNeonEndpoint(connectionString)) {
    logger.error(
      '[engine] singleton advisory lock is using a Neon POOLED endpoint; session-level ' +
        'advisory locks are UNRELIABLE over a transaction pooler and split-brain singleton ' +
        'election is possible. Set ENGINE_SINGLETON_DATABASE_URL to a direct, unpooled Neon ' +
        'connection string to make election sound.',
    );
  }
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
      let consecutiveTransportFailures = 0;

      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        let client: PoolClient | undefined;
        try {
          client = await pool.connect();
          const result = await client.query<{ acquired: boolean }>(
            `SELECT pg_try_advisory_lock(hashtext($1)) AS acquired`,
            [lockKey],
          );
          consecutiveTransportFailures = 0;
          if (result.rows[0]?.acquired === true) {
            return new PostgresAdvisoryLease(pool, client, logger);
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
          consecutiveTransportFailures += 1;
          if (consecutiveTransportFailures >= MAX_CONSECUTIVE_TRANSPORT_FAILURES) {
            await pool.end();
            throw error instanceof Error ? error : new Error(String(error));
          }
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
    private readonly logger: Pick<Console, 'error'>,
  ) {}

  async release(): Promise<void> {
    try {
      // The acquire path already checks its boolean (`AS acquired`); this
      // mirrors that here so a no-op unlock is not indistinguishable from a
      // real one. `pg_advisory_unlock` returns `false` (not an error) when
      // the current session does not hold the lock — the exact symptom of a
      // session-level lock split across PgBouncer transaction-pooled
      // backends (see the module header comment).
      const result = await this.client.query<{ released: boolean }>(
        `SELECT pg_advisory_unlock(hashtext($1)) AS released`,
        [lockKey],
      );
      if (result.rows[0]?.released !== true) {
        const message =
          '[engine] pg_advisory_unlock returned false; the singleton advisory lock was NOT ' +
          'released by this session and will leak until reaped. This is likely a pooled ' +
          '(PgBouncer transaction-mode) endpoint routing the unlock to a different backend ' +
          'than the one that acquired the lock — set ENGINE_SINGLETON_DATABASE_URL to a ' +
          'direct, unpooled connection string.';
        this.logger.error(message);
        // Must throw, not just log: a resolved release() would let
        // `EngineRuntime.release()` and `createSignalShutdown` treat this as
        // a successful handoff — logging "shutdown complete" and skipping
        // retries — even though the lock is still held. Throwing keeps the
        // caller's retry/failure-reporting path (see `index.ts`) truthful.
        throw new Error(message);
      }
    } finally {
      this.client.release();
      await this.pool.end();
    }
  }
}
