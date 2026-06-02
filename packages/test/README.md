# @tribunal/test

Test utilities and infrastructure for the Tribunal monorepo.

## Usage

```typescript
import { createTestDatabase } from '@tribunal/test/database';
import { createTestContext } from '@tribunal/test/context';
```

## Performance Testing

### Timing Tests

Timing tests in `src/database-timing.test.ts` validate PGlite cold-start performance budgets. By default they only log a warning when `createTestDatabase()` is slow; they never fail the suite. This keeps them safe on resource-constrained CI runners.

**Default Mode (CI):**

- Verifies functional correctness
- Logs a warning when initialization exceeds the soft budget (80% of the hard budget)
- Does not fail on performance regressions
- Uses a generous timeout (max of 60s or budget + 5s)

**Timing Mode (Local/On-Demand):**

- Strict performance budget enforcement — fails if the hard budget is exceeded
- Uses a tighter timeout (budget + 5s)
- Recommended for performance regression testing

**Usage:**

```bash
# Local performance validation
TRIBUNAL_TIMING_TESTS=true bun run --filter '@tribunal/test' test src/database-timing.test.ts

# Custom budget (milliseconds)
TRIBUNAL_TIMING_TESTS=true TRIBUNAL_TIMING_PGLITE_INIT=20000 bun run --filter '@tribunal/test' test src/database-timing.test.ts
```

**Current Budgets:**

- PGlite initialization: 25s (configurable via `TRIBUNAL_TIMING_PGLITE_INIT`)

## Configuration

Test behavior is controlled by environment variables. See `src/config/test-config.ts` for available options:

- `TRIBUNAL_TIMING_TESTS=true` (or `=1`) — Enable strict performance assertions
- `TRIBUNAL_TIMING_PGLITE_INIT=<ms>` — Override PGlite initialization budget (default: 25000)
