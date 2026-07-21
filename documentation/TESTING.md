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
`githubInstallation`, `repository`, `pullRequest`, `webhookDelivery`, and `userApiKey`. Call
`resetIdCounter()` per test to keep generated IDs deterministic. See
`applications/web/src/lib/server/api-keys/user-api-key-service.test.ts` for a worked example.

## Fixtures and Test Data

- E2E fixtures: `applications/web/test/end-to-end/fixtures/` (`auth.ts`, `e2e-auth.ts`, `multi-user.ts`).
- Shared test utilities live in `applications/web/test/` and are imported via the `$testing` alias
  (configured in `applications/web/svelte.config.js`).
- Cross-package test helpers (database, factories, port allocation) live in `packages/test`.

## Coverage Gates

Every workspace enforces **100% lines and 100% functions** (branches are deliberately not
gated). Run the full monorepo gate from the repository root:

```bash
bun run test:coverage
```

This chains each workspace's own `test:coverage` script. CI enforces the same command in
the `coverage` job of `.github/workflows/ci.yml`, so a coverage regression fails the merge
gate.

Per-workspace scopes:

- Node packages (`packages/*`, `applications/engine`, `applications/proxy`) gate
  `src/**/*.ts` via `coverage.thresholds` in each vitest configuration. Barrel and
  type-only files (`index.ts`, `types.ts`) and `packages/database/src/test/**`
  (operational tooling that drives real Neon branches) are excluded.
- `scripts` gates only `lib/**/*.ts` (the shared helper library). The ~2,900 lines of
  top-level `scripts/*.ts` CLIs (`deploy.ts`, `doctor.ts`,
  `check-migration-consistency.ts`, etc.) are operational tooling that shells out to
  Fly, GitHub, and Neon against live infrastructure — the same rationale as the
  `packages/database/src/test/**` exclusion above — and are not currently gated at
  all. Tracked as a follow-up in
  [stevekinney/tribunal#179](https://github.com/stevekinney/tribunal/issues/179).
- `applications/web` gates per project: `test:coverage:server` covers `src/**/*.ts` in the
  Node server project; `test:coverage:client` covers `src/**/*.svelte` rendered in real
  Chromium. Components are measured only in the client project because the server project
  would instrument their SSR-compiled shape, which no server test renders — the same
  component measured in two compile shapes cannot merge into one honest number.
- `packages/github` additionally keeps the narrower `test:coverage:review-engine` script,
  which overrides scope via CLI flags for the review-engine deploy gate.
- `runner` runs its plain `test` script (a single Vitest file, no coverage
  instrumentation) and has no coverage gate at all — including for
  `verify-image.mjs`, which currently has no test coverage of any kind. Also
  tracked in [stevekinney/tribunal#179](https://github.com/stevekinney/tribunal/issues/179).

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

## API Key Test Coverage

Customer API key lifecycle tests span multiple layers. The feature lives under
`applications/web/src/lib/server/api-keys/` and the authenticated route
`applications/web/src/routes/(authenticated)/api-keys/`.

### Server Authentication

**File:** `applications/web/src/lib/server/api-keys/user-auth.test.ts`

Tests authorization header parsing, validation, and authentication outcomes:

- Authorization header matrix (missing, malformed, invalid, unknown, revoked, expired, valid)
- Non-leaking error messages (no userId or key existence information)
- Timing-safe hash verification

### Service Layer

**File:** `applications/web/src/lib/server/api-keys/user-api-key-service.test.ts`

Tests create/list/rotate/revoke contracts against a real database (PGlite):

- Active key cap enforcement (10 keys maximum)
- Cross-user ownership protection
- Revoked/expired keys do not count toward the active limit
- Name and metadata preservation during rotation
- Hash storage (never stores raw keys)

### API Endpoint

**File:** `applications/web/src/routes/api/api-keys/check/server.test.ts`

Tests the endpoint contract and security boundaries:

- Valid key returns 200 with non-sensitive metadata only
- All invalid states (unknown, revoked, expired) return 401 with an identical error schema
- No distinguishing information in error responses (prevents key enumeration)

### Form Actions

**File:** `applications/web/src/lib/server/api-keys/+page.server.test.ts`

Tests the SvelteKit action and load function behavior with a mocked `RequestEvent`:

- Create action returns the one-time `rawKey` in its response
- List (load) never includes secrets or hashes
- Rotate invalidates the old key immediately and returns a new `rawKey`
- Revoke succeeds without returning a `rawKey`
- Cross-user protection (user A cannot rotate or revoke user B's key)

### End-to-End Workflows

**File:** `applications/web/test/end-to-end/profile/api-keys.test.ts`

Tests complete user workflows in the browser:

- One-time secret disclosure (shown only after create/rotate)
- Secret not visible after navigation or refresh
- Clipboard integration
- Key invalidation (revoked/rotated keys return 401 on an auth check)
- Multi-user isolation (users cannot see or modify each other's keys)
- Active key limit enforcement (10 keys)

### Permission Regression

**File:** `applications/web/test/end-to-end/permissions/form-action-auth.test.ts`

Tests cross-user and unauthenticated access controls:

- Unauthenticated requests blocked at the route level (401/403)
- Cross-user operations fail without leaking key existence or ownership details

### Test Utilities

**File:** `applications/web/src/lib/test-utils/request-event.ts`

Provides `createMockRequestEvent()` for testing SvelteKit server functions:

- Mocks `RequestEvent` with a custom URL, method, headers, body, and locals
- Converts plain objects to `FormData` for action testing

### Running API Key Tests

```bash
# Unit tests (auth, service layer, endpoint contract, form actions)
bun run test

# Server-side unit tests only
bun run --cwd applications/web test:unit:server

# End-to-end tests (lifecycle, permissions, key invalidation)
bun run --cwd applications/web test:e2e

# Full validation (type checking + Svelte check)
bun run --cwd applications/web check
```

## Related Rules

- `../.claude/rules/testing.md`
