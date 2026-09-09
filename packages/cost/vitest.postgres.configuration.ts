import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@tribunal/review-core/review-cost-limits': fileURLToPath(
        new URL('../review-core/src/review-cost-limits.ts', import.meta.url),
      ),
    },
  },
  test: {
    include: ['src/**/*.postgres-spec.ts'],
    /**
     * These cases are slow on purpose. Each opens several PostgreSQL sessions,
     * holds a row lock, races concurrent writers against it, and polls
     * `pg_stat_activity` until they are observably blocked -- that waiting is
     * the thing under test, not overhead to be optimised away.
     *
     * Vitest's 5000ms default left no headroom for that on a contended runner.
     * Measured across 49 passing cases from recent CI runs: median 371ms, p90
     * 929ms, p95 1603ms, max 4827ms -- a case that passed within 173ms of the
     * limit, a 13x spread over the median driven by runner contention rather
     * than by the work. Observed timeouts (5004ms, 5008ms) sit just past it.
     *
     * 30s is roughly six times the slowest passing case, and far below any
     * duration that would hide a real hang: a genuine deadlock here is a lock
     * wait that never resolves, so it is caught by any finite timeout.
     *
     * This is not papering over the TRI-109 contamination bug. That was fixed
     * and proven fixed -- the serialization gate and the seeded-state
     * assertions in ledger.postgres-spec.ts still fail loudly if a case ever
     * leaks into its successor again, whatever this number is. See TRI-118.
     */
    testTimeout: 30_000,
    /**
     * Matched to `testTimeout` because the teardown hook waits on the same thing
     * the timeout bounds. `afterAll` awaits `previousCaseTeardown` before closing
     * the admin connection, so when a case overruns and Vitest abandons it, the
     * hook inherits the remainder of that case's wait.
     *
     * Leaving this at Vitest's 10s default does not make a passing run fail --
     * when every case finishes, the chain is already settled and the hook returns
     * immediately. It only bites after a case has *already* failed, and there it
     * makes things worse: the hook times out on top of the real failure, so the
     * report leads with teardown noise instead of the case that overran, and
     * `adminClient.end()` never runs, leaving a connection open and Vitest
     * complaining that something is keeping the process alive.
     */
    hookTimeout: 30_000,
  },
});
