# Tests overview

This directory holds app-specific test infrastructure and end-to-end tests.
Shared test utilities (database, factories, port allocation) have been extracted to
`@tribunal/test` (`packages/test/`).

## Directory structure

```
/test
├── vitest.setup.ts       # Shared Vitest setup (browser cleanup)
└── end-to-end/           # Playwright E2E tests
    ├── database.ts       # E2E database (intra-directory import)
    ├── seed.ts           # E2E database seeding
    ├── handle.ts         # E2E auth bypass hook
    ├── helpers.ts        # E2E session helpers
    ├── operator-ui.spec.ts
    ├── review-engine.spec.ts
    └── security/
```

## Import alias

The `$testing` alias in `svelte.config.js` still resolves to this directory. It is used
by `end-to-end/` files (`handle.ts`, `seed.ts`, `database.ts`) for intra-directory imports.

For shared test utilities, import from `@tribunal/test` instead:

```ts
import { createTestDatabase, type TestDatabase } from '@tribunal/test/database';
import { createTestContext, type TestContext } from '@tribunal/test/context';
import { createUserFactory } from '@tribunal/test/factories';
import { findFreePort } from '@tribunal/test/port';
```

## Test type locations

| Test Type       | Location                             |
| --------------- | ------------------------------------ |
| Unit tests      | Co-located with source (`*.test.ts`) |
| Component tests | Co-located (`*.svelte.test.ts`)      |
| E2E tests       | `test/end-to-end/`                   |

## Running tests

```bash
bun run test                # Unit + component tests (vitest)
bun run --cwd applications/web test:unit:server    # Server-side unit tests only
bun run --cwd applications/web test:unit:client    # Browser component tests only
bun run --cwd applications/web test:e2e            # Playwright E2E
```

## E2E fixtures

See `test/end-to-end/README.md` for fixture setup and helper utilities.
