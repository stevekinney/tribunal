import { describe, it } from 'vitest';
import { createTestDatabase } from './database';
import { testConfig } from './config/test-config';

/**
 * Timing diagnostics for PGlite cold-start.
 *
 * By default these tests only log a warning when createTestDatabase() takes
 * longer than expected; they never fail the suite. Set the env var
 * TRIBUNAL_TIMING_TESTS=true to enable hard assertions — useful when you are
 * explicitly validating performance on a known-good runner.
 *
 * The hard budget (25s by default) is configurable via TRIBUNAL_TIMING_PGLITE_INIT.
 * The timeout scales with the configured budget (max of 60s or budget + 5s) to
 * ensure tests can complete and log warnings even when large budgets are configured.
 * In timing mode, the timeout is always budget + 5s to ensure the test can evaluate
 * the budget before Vitest kills it.
 */

const HARD_BUDGET_MS = testConfig.timing.budgets.pgliteInit;
// Soft budget is 80% of hard budget to provide early warning before hard failure
const SOFT_BUDGET_MS = Math.floor(HARD_BUDGET_MS * 0.8);
const hardAssert = testConfig.timing.enabled;

// In timing mode, derive timeout from configured budget with 5s headroom
const TIMING_MODE_TIMEOUT = HARD_BUDGET_MS + 5_000;
// In default mode, use generous timeout that scales with configured budget
// to prevent timeouts when users set large budgets
const DEFAULT_TIMEOUT = Math.max(60_000, HARD_BUDGET_MS + 5_000);

function checkTiming(elapsed: number, label: string): void {
  if (hardAssert) {
    if (elapsed >= HARD_BUDGET_MS) {
      throw new Error(
        `[tribunal-test:timing] ${label} exceeded ${HARD_BUDGET_MS}ms budget: ${elapsed.toFixed(0)}ms`,
      );
    }
  } else if (elapsed > SOFT_BUDGET_MS) {
    console.warn(
      `[tribunal-test:timing] ${label} slow: ${elapsed.toFixed(0)}ms (budget ${HARD_BUDGET_MS}ms). ` +
        `Set TRIBUNAL_TIMING_TESTS=true to make this a hard failure.`,
    );
  }
}

describe('createTestDatabase timing', () => {
  it(
    'completes single initialization within budget',
    async () => {
      const start = performance.now();
      const testDb = await createTestDatabase();
      const elapsed = performance.now() - start;

      try {
        checkTiming(elapsed, 'single initialization');
      } finally {
        await testDb.close();
      }
    },
    hardAssert ? TIMING_MODE_TIMEOUT : DEFAULT_TIMEOUT,
  );

  it(
    'sequential create-close cycles do not accumulate latency',
    async () => {
      const timings: number[] = [];

      for (let i = 0; i < 3; i++) {
        const start = performance.now();
        const testDb = await createTestDatabase();
        timings.push(performance.now() - start);
        await testDb.close();
      }

      for (const [index, timing] of timings.entries()) {
        checkTiming(timing, `cycle ${index + 1}`);
      }

      // Subsequent cycles should benefit from cached migration SQL
      // and not be significantly slower than the first
      const [first, ...rest] = timings;
      for (const [index, subsequent] of rest.entries()) {
        // Allow 50% overhead tolerance — subsequent should not be much slower
        const limit = (first ?? 0) * 1.5 + 1_000;
        if (subsequent >= limit) {
          const message =
            `[tribunal-test:timing] cycle ${index + 2} (${subsequent.toFixed(0)}ms) ` +
            `significantly slower than cycle 1 (${(first ?? 0).toFixed(0)}ms)`;
          if (hardAssert) {
            throw new Error(message);
          } else {
            console.warn(message);
          }
        }
      }
    },
    hardAssert ? TIMING_MODE_TIMEOUT * 3 : DEFAULT_TIMEOUT * 3,
  );
});
