# Database Migration Testing Infrastructure

Phase 1: Validation Infrastructure for testing schema migrations on ephemeral Neon branches.

## Overview

This infrastructure validates that schema migrations maintain critical database invariants by:

1. Creating ephemeral Neon branches for isolated testing
2. Running migrations against the branch
3. Validating database invariants
4. Cleaning up resources (even on failure)

## Files

### `neon-branch.ts`

Ephemeral Neon branch management using the Neon API client.

**Key functions:**

- `createEphemeralBranch(projectId, parentBranch?, namePrefix?)` - Creates a temporary branch with minimal compute (0.25 CU)
- `runMigrationsOnBranch(connectionUri)` - Executes drizzle-kit migrations

**Usage:**

```typescript
const branch = await createEphemeralBranch(projectId);
try {
  await runMigrationsOnBranch(branch.connectionUri);
  // Run tests...
} finally {
  await branch.cleanup(); // Always cleanup!
}
```

### `validate-invariants.ts`

Framework for validating critical database invariants.

**Checks implemented:**

1. All schema tables exist in database
2. All foreign key columns have indexes (project convention)
3. Migration count > 0 in drizzle_migrations table
4. Timestamp columns use `timestamp with time zone` (newer tables)
5. ID/timestamp columns are NOT NULL
6. UNIQUE constraints exist where expected
7. Text over varchar preference (warning level)

**Usage:**

```typescript
import { validateInvariants } from './validate-invariants';

const result = await validateInvariants(connectionUri);
if (!result.passed) {
  console.error('Errors:', result.errors);
  process.exit(1);
}
```

**CLI usage:**

```bash
DATABASE_URL="postgresql://..." bun src/test/validate-invariants.ts
```

### `run-migration-tests.ts`

Orchestrates the full test flow:

1. Creates ephemeral branch
2. Runs migrations
3. Validates invariants
4. Writes test results to `test-results/`
5. Cleans up branch

**Usage:**

```bash
NEON_API_KEY="..." NEON_PROJECT_ID="..." bun src/test/run-migration-tests.ts
```

## Environment Variables

- `NEON_API_KEY` - API key for Neon branch management (required for branch operations)
- `NEON_PROJECT_ID` - Target Neon project ID (required for branch operations)
- `DATABASE_URL` - Connection string for validation-only mode

## Package Scripts

From `packages/database/`:

```bash
# Run full migration test suite
bun run db:test-migrations

# Validate invariants against existing database
bun run db:validate-invariants
```

## Test Results

Test results are written to `packages/database/test-results/` in JSON format:

```json
{
  "success": true,
  "timestamp": "2026-02-24T12:00:00.000Z",
  "branchId": "br-...",
  "duration": 15234,
  "validationResult": {
    "passed": true,
    "checks": [...],
    "errors": [],
    "warnings": []
  }
}
```

The `test-results/` directory is gitignored.

## Adding New Invariant Checks

To add a new check, add an entry to the `invariantChecks` array in `validate-invariants.ts`:

```typescript
{
  name: 'check_name',
  severity: 'error', // or 'warning'
  errorMessage: 'Description of what failed',
  query: `
    SELECT ...
    FROM ...
    WHERE condition_that_indicates_failure
  `,
  validate: (rows) => {
    // Return false if rows indicate a problem
    if (rows.length > 0) {
      console.error('Problem detected:', rows);
      return false;
    }
    return true;
  },
}
```

## GitHub Actions Integration

The test runner outputs GitHub Actions-compatible annotations:

- `::error::` for validation failures
- `::warning::` for non-critical issues

Exit codes:

- `0` - All tests passed
- `1` - Tests failed or error occurred

## Cost Optimization

Ephemeral branches use minimal compute configuration:

- 0.25 CU (smallest available)
- Auto-suspend disabled for test stability
- Immediate cleanup in finally blocks

Typical branch lifetime: < 2 minutes
