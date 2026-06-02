/**
 * Centralized test configuration driven by environment variables.
 *
 * TRIBUNAL_TIMING_TESTS=true: Enable strict performance budget assertions
 * TRIBUNAL_TIMING_PGLITE_INIT: Override PGlite init budget in milliseconds (default: 25000)
 */

const DEFAULT_PGLITE_INIT_BUDGET_MS = 25000;

const rawPgliteInit = process.env['TRIBUNAL_TIMING_PGLITE_INIT'];
const parsedPgliteInit =
  rawPgliteInit !== undefined ? Number.parseInt(rawPgliteInit, 10) : DEFAULT_PGLITE_INIT_BUDGET_MS;
const pgliteInitBudget =
  Number.isFinite(parsedPgliteInit) && parsedPgliteInit > 0
    ? parsedPgliteInit
    : DEFAULT_PGLITE_INIT_BUDGET_MS;

export const testConfig = {
  timing: {
    enabled:
      process.env['TRIBUNAL_TIMING_TESTS'] === 'true' ||
      process.env['TRIBUNAL_TIMING_TESTS'] === '1',
    budgets: {
      pgliteInit: pgliteInitBudget,
    },
  },
} as const;
