# Tests overview

This directory holds app-specific test infrastructure and end-to-end tests.
Shared test utilities (database, factories, accessibility, port allocation) have been
extracted to `@tribunal/test` (`packages/test/`).

## Directory structure

```
/test
├── vitest.setup.ts       # Shared Vitest setup (browser cleanup)
├── browser/              # Browser test helpers
└── end-to-end/           # Playwright E2E tests
    ├── fixtures/         # Auth helpers, multi-user scenarios
    ├── accessibility/    # Storybook a11y tests (axe-core)
    ├── sveltekit/        # SvelteKit routing and SSR coverage
    ├── utilities/        # Wait helpers, test utilities
    ├── database.ts       # E2E database (intra-directory import)
    ├── seed.ts           # E2E database seeding
    ├── handle.ts         # E2E auth bypass hook
    └── README.md         # E2E-specific docs
```

> [!NOTE] Residual test directories
> Some directories under `end-to-end/` (for example `goals/`, `projects/`,
> `workspaces/`, `agents/`, and parts of `permissions/`) are leftovers from an
> earlier, larger system. Those product features no longer exist in Tribunal, so
> these suites are scheduled for removal — do not treat them as coverage for any
> current surface.

## Import alias

The `$testing` alias in `svelte.config.js` still resolves to this directory. It is used
by `end-to-end/` files (`handle.ts`, `seed.ts`, `database.ts`) for intra-directory imports.

For shared test utilities, import from `@tribunal/test` instead:

```ts
import { createTestDatabase, type TestDatabase } from '@tribunal/test/database';
import { createTestContext, type TestContext } from '@tribunal/test/context';
import { createUserFactory } from '@tribunal/test/factories';
import { findFreePort } from '@tribunal/test/port';
import { expectNoA11yViolations } from '@tribunal/test/accessibility';
```

## Test type locations

| Test Type       | Location                             |
| --------------- | ------------------------------------ |
| Unit tests      | Co-located with source (`*.test.ts`) |
| Component tests | Co-located (`*.svelte.test.ts`)      |
| E2E tests       | `test/end-to-end/`                   |
| A11y tests      | `test/end-to-end/accessibility/`     |

## Running tests

```bash
bun run test                # Unit + component tests (vitest)
bun run --cwd applications/web test:unit:server    # Server-side unit tests only
bun run --cwd applications/web test:unit:client    # Browser component tests only
bun run --cwd applications/web test:e2e            # Playwright E2E
bun run --cwd applications/web test:accessibility  # Accessibility only
```

## E2E fixtures

See `test/end-to-end/README.md` for fixture setup and helper utilities.
