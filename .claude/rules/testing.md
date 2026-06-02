---
paths:
  - src/**/*.test.ts
  - src/**/*.svelte.test.ts
  - src/**/*.spec.ts
  - src/**/*.svelte.spec.ts
  - test/**
  - test/end-to-end/**
  - documentation/examples/**
  - playwright.config.*
  - vitest.config*.*
  - vitest.setup.*
---

# Testing

Before editing paths in this rule, load `$component-standards` and apply its constraints for frontend and frontend-testing surfaces.
For code examples and environment tables, see `component-standards` references.

## Environment selection

- `*.test.ts` runs in Node.js -- use for pure logic and server code.
- `*.svelte.test.ts` runs in Browser (Playwright) -- use when the test needs `document`, `window`, or `navigator`.
- Avoid `@vitest-environment jsdom`.
- Use `.svelte.test.ts` (not `.test.ts`) for component tests so they run in the browser project.

## Browser tests

- Always call `cleanup()` in `afterEach`.
- Import `render` and `cleanup` from `vitest-browser-svelte`.

## Key rules

- Test observable behavior, not implementation details.
- In package scripts, use `vitest run` for non-watch commands (`test`, `test:unit:*`, pre-commit flows).
- Anchors without `href` do not expose a `link` role; use `getByLabelText` or assert on attributes.
- When accessible labels vary by state, assert against the state-specific label.
- Use `vi.resetModules()` + `vi.doMock()` for isolated module mocking.
- Compute fixture positions dynamically with `indexOf()`; avoid hardcoded offsets.
- When deriving changed-only prefixes from `src/lib/components`, handle files directly in the folder separately from component subfolders.
- Ensure tests can fail for the intended reason: avoid passing matcher objects (for example `expect.any(...)`) as runtime input data.

## Test database initialization order

- Create the test database at module level before `vi.mock()` calls. Mocks evaluate at import time; variables referenced in mock factories must already exist.
- Use the getter pattern (`get db()`) to return the database instance dynamically.

## Route-level behavioral tests

- Navigation changes must include E2E tests asserting URL + rendered content for the transition.
- Back/forward browser navigation must be tested for any route that changes page content.
- Form actions must have tests for both success and failure-in-200-envelope handling. A 200 response with `{ type: 'failure' }` must render error UI, not success UI.
- Place route-level Playwright tests in `applications/web/test/end-to-end/sveltekit/`.
- See `documentation/testing/route-behavior-checklist.md` for the full checklist.

## Full-height layout contract tests

- Surfaces with full-height/pinned-element layouts (repository, navigation) must have tests asserting the flex container fills the viewport and the pinned element stays at the bottom.
- Verify layout behavior at both narrow (375px) and wide (1280px) viewports.
- Verify container query behavior at breakpoints when applicable.

## E2E essentials

- Use `127.0.0.1`, not `localhost`, for local URLs.
- Never hardcode port 4173; import `svelteKitBaseURL` from `playwright.config.ts`.
- Shared in-memory database: use `test.describe.configure({ mode: 'serial' })`.
- Make test data unique (timestamp suffix) to avoid collisions on repeats.
- Wait for form readiness via `data-can-submit` and also assert `toBeEnabled()`.
- For clearing inputs, prefer `locator.selectText()` or triple-click; avoid `Control+a` on macOS.

## E2E seeding idempotency

- Use `onConflictDoUpdate` instead of `onConflictDoNothing` to ensure the requested state is applied.
- When using upsert with a fallback SELECT, always validate the result exists.

## Svelte hydration timing

- Use focus-then-click pattern: focus confirms the element is interactive before clicking.

## Session cookie propagation guard

- After `page.goto()` with a fresh authenticated context, wait for content that requires the session before making assertions.

## Environment variable flags for test server control

- Use strict equality (`=== '1'`) for boolean flags; `Boolean()` treats `'0'` and `'false'` as truthy.
- Distinguish local URLs from external URLs by parsing the hostname; locally populated `.env` files contain local URLs.
- Apply the same local-versus-external check at both the producer (`scripts/run-playwright.ts`) and consumer (`playwright.config.ts`).

## Avoid `waitForTimeout`

- Use `page.waitForLoadState('networkidle')`, `page.waitForURL(...)`, or `expect(locator).toBeVisible()` instead.

## Sequential click-then-wait

- Click first, then wait for navigation. Do not use `Promise.all` with `waitForURL` and `click`.

## E2E endpoint validation

- Use Zod validation, not type assertions, for test endpoint request bodies.
- Always check `response.ok()` before using response data.

## Direct dependency declaration for test imports

- If a package imports a module directly in tests (for example `@tribunal/test/database` or `@electric-sql/pglite`), declare it in that package's `devDependencies`.
- Do not rely on transitive or hoisted dependencies from other workspaces.

## Pre-commit worker test timeout and termination

- When spawning long-running Vitest subprocesses in scripts, enforce an explicit timeout.
- If timeout is exceeded, terminate the subprocess with a non-ignorable signal (`SIGKILL`) after graceful shutdown attempts.

## Deterministic time

- Use `vi.useFakeTimers()` at the narrowest scope needed.
- Always call `vi.useRealTimers()` in `afterEach` or `finally`.
- For browser tests, use `{ shouldAdvanceTime: true }`.
- Scope fake timers to individual tests when only one test needs them.
- Do not use fake timers globally when tests use deferred promises with manual resolution.
- Bun test runner limitation: `vi.advanceTimersByTime()` may not work; manipulate database timestamps directly instead.

## vitest.setup.ts constraints

- Do not import modules with optional peer dependencies in `test/vitest.setup.ts`; Vite resolves all optional dependencies at setup time.
- Pre-warm expensive imports in individual test files' `beforeAll` hooks instead.

## Coverage script

- Only rewrite spec files. Never touch `test/end-to-end/fixtures` or test harness wrappers.

## Accessibility testing with axe-core

- Disable `landmark-one-main`, `page-has-heading-one`, and `region` rules for isolated component testing.
- Use `withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])` for WCAG coverage.
