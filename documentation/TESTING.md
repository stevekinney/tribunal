# Testing

This guide explains how tests are organized in Tribunal and which runner to use.

## Quick Start

```bash
bun run test                                       # All unit tests across the monorepo (via Turbo)
bun run --cwd applications/web test:e2e            # Playwright E2E (SvelteKit build + preview)
```

## Test Types Overview

| What to Test        | Project / Runner       | Naming / Location                   | Command                                           |
| ------------------- | ---------------------- | ----------------------------------- | ------------------------------------------------- |
| Component rendering | Vitest `client`        | `*.svelte.test.ts`                  | `bun run --cwd applications/web test:unit:client` |
| Server logic        | Vitest `server` (node) | `*.test.ts`                         | `bun run --cwd applications/web test:unit:server` |
| User flows          | Playwright E2E         | `applications/web/test/end-to-end/` | `bun run --cwd applications/web test:e2e`         |

`bun run test` from the repository root runs the Vitest unit suites for every workspace through Turbo. In
`applications/web`, that target expands to `test:unit:server && test:unit:client`.

## Test File Placement

- `.svelte.test.ts` runs in the Vitest `client` project (a real Chromium browser via the Playwright provider).
- `.test.ts` runs in the Vitest `server` project (Node environment).
- Co-locate unit tests next to the source files under `src/`.
- E2E tests live under `applications/web/test/end-to-end/`. Standalone browser component tests live under
  `applications/web/test/browser/`.

The web Vitest projects are defined in `applications/web/vite.config.ts`.

## Environment Decision Tree

```
Does the test use DOM/browser APIs?
├─ Yes → name it *.svelte.test.ts (client project, browser)
└─ No  → name it *.test.ts        (server project, Node)
```

## Writing Your First Test

### Component (browser)

```typescript
import { render, cleanup } from 'vitest-browser-svelte';
import { describe, it, expect, afterEach } from 'vitest';
import Button from './button.svelte';

describe('Button', () => {
  afterEach(() => cleanup());

  it('renders the label', () => {
    const { getByRole } = render(Button, { props: { label: 'Save' } });
    expect(getByRole('button', { name: 'Save' })).toBeTruthy();
  });
});
```

### E2E (Playwright)

```typescript
import { test, expect } from '@playwright/test';
import { svelteKitBaseURL } from '../../playwright.config';

test('landing page loads', async ({ page }) => {
  await page.goto(`${svelteKitBaseURL}/`);
  await expect(page).toHaveTitle(/Tribunal/);
});
```

## Database Tests

Server-side tests that touch persistence run against an in-memory PostgreSQL instance (PGlite) rather than a
live database. Use the shared helper and factories from `@tribunal/test`:

```typescript
import { createTestDatabase } from '@tribunal/test/database';
import { createUserFactory, resetIdCounter } from '@tribunal/test/factories';
```

`createTestDatabase()` spins up a PGlite client with the current Drizzle schema applied. The factories in
`@tribunal/test/factories` mirror the flat data model — `user`, `oauthConnection`,
`githubInstallation`, `repository`, `pullRequest`, and `webhookDelivery`. Call
`resetIdCounter()` per test to keep generated IDs deterministic.

## Fixtures and Test Data

- E2E fixtures: `applications/web/test/end-to-end/fixtures/` (`auth.ts`, `e2e-auth.ts`, `multi-user.ts`).
- Shared test utilities live in `applications/web/test/` and are imported via the `$testing` alias
  (configured in `applications/web/svelte.config.js`).
- Cross-package test helpers (database, factories, port allocation) live in `packages/test`.

## Coverage Gates

Every workspace with executable source enforces **100% lines and 100% functions**
(branches are deliberately not gated), with the scoped `scripts` top-level CLI
exception noted below. `packages/typescript` is a shared tsconfig-only
package with no executable source and no test script. Run the full monorepo gate from the
repository root:

```bash
bun run test:coverage
```

This chains each workspace's own `test:coverage` script. CI enforces the same command in
the `coverage` job of `.github/workflows/ci.yml`, so a coverage regression fails the merge
gate.

Per-workspace scopes:

- Node packages (`packages/*`, `applications/engine`, `applications/proxy`) gate
  `src/**/*.ts` via `coverage.thresholds` in each vitest configuration. Every package
  excludes its own `src/**/*.test.ts`; most also exclude barrel/type-only files
  (`index.ts`, `types.ts`), and a few carve out additional package-specific files
  (e.g. `packages/review-core` excludes `src/ports.ts`). `packages/database` additionally excludes
  `src/test/**` (operational tooling that drives real Neon branches). Check each
  package's `vitest.configuration.ts` for its exact `coverage.exclude` list.
- `scripts` gates `lib/**/*.ts` (the shared helper library). Top-level
  `scripts/*.ts` files are classified in `scripts/OWNERSHIP.md`: deterministic
  helpers belong in `scripts/lib/**` and live Fly, GitHub, Neon, hook, and
  repository-orchestration entrypoints remain intentionally excluded from the
  unit coverage gate.
- `applications/web` gates per project: `test:coverage:server` covers `src/**/*.ts` in the
  Node server project; `test:coverage:client` covers `src/**/*.svelte` rendered in real
  Chromium. Components are measured only in the client project because the server project
  would instrument their SSR-compiled shape, which no server test renders — the same
  component measured in two compile shapes cannot merge into one honest number.
- `packages/github` additionally keeps the narrower `test:coverage:review-engine` script,
  which overrides scope via CLI flags for the review-engine deploy gate.
- `runner` gates `run-agent.mjs` and `verify-image-checks.mjs` with 100% lines
  and functions through `bun run --cwd runner test:coverage`. `verify-image.mjs`
  is a thin process-exit wrapper over the tested `verify-image-checks.mjs`
  behavior.

When measuring locally alongside other running suites, pass a distinct
`--coverage.reportsDirectory` — concurrent runs sharing one `coverage/.tmp` clobber each
other's intermediate files.

## Notes

- E2E runs a production build and preview server. The Playwright config
  (`applications/web/playwright.config.ts`) sets `CI=true` and `E2E_TEST_MODE=1` to enable test-only auth
  bypass routes.
- E2E runs go through `applications/web/playwright.config.ts`, which allocates a consistent port for
  Playwright workers.
- This checkout has no `packages/components` Storybook suite. Cover UI behavior with web browser component tests and Playwright end-to-end tests.

## Test Utilities

**File:** `applications/web/src/lib/test-utils/request-event.ts`

Provides `createMockRequestEvent()` for testing SvelteKit server functions:

- Mocks `RequestEvent` with a custom URL, method, headers, body, and locals
- Converts plain objects to `FormData` for action testing

## Related Rules

- `../.claude/rules/testing.md`
