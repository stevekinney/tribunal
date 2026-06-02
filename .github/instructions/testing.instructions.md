---
applyTo: '**/*.test.ts,**/*.svelte.test.ts,**/*.spec.ts,**/test/**,**/*.stories.ts'
---

# Testing Review Heuristics

These cover the Tribunal monorepo: the SvelteKit app in `applications/web` and the shared `@tribunal/*` packages (notably `@tribunal/components`). Use `@tribunal/*` package names in tests and stories; that is the only workspace namespace.

## Commands

- App unit tests run as Vitest projects: `test:unit:server` (Node) and `test:unit:client` (browser). `bun run test` from `applications/web` runs both.
- End-to-end tests run through Playwright via `bun run test:e2e`; accessibility runs via `bun run test:accessibility`.
- Always use these workspace scripts. Never run `bun test` directly.

## Environment selection

- `*.test.ts` → Node.js (pure logic and server code)
- `*.svelte.test.ts` → Browser via Playwright (DOM, `window`, `navigator`)
- Avoid `@vitest-environment jsdom`. Use `.svelte.test.ts` for component tests so they run in the browser project.

## Browser tests

- Always call `cleanup()` in `afterEach`.
- Import `render` and `cleanup` from `vitest-browser-svelte`.
- Use `vi.useFakeTimers()` at the narrowest scope needed. Always call `vi.useRealTimers()` in `afterEach`.
- For browser fake timers, use `{ shouldAdvanceTime: true }`.

## Key rules

- Test observable behavior, not implementation details.
- Use `vitest run` for non-watch commands.
- Compute fixture positions dynamically with `indexOf()`; avoid hardcoded offsets.
- If a test imports a package directly, declare it in that workspace's `devDependencies`.

## Storybook stories

- Storybook lives in `@tribunal/components` (`packages/components/`); stories sit next to their component (for example `packages/components/src/spinner/spinner.stories.ts`).
- Every new component under `packages/components/src/` must include at least one story.
- Import interaction utilities from `storybook/test` (not `@storybook/test`).
- Use `behavior: 'auto'` (not `'instant'`) for `scrollTo()` calls. Valid `ScrollBehavior` values: `'auto'` and `'smooth'`.
- Use deterministic IDs and timestamps in test data factories — avoid module-level counters.
- Cover all enum/union values in stories.
- Use `waitFor()` with assertions inside the callback instead of custom polling loops.
- For refresh flows, `waitFor` the stale badge or enabled button state before clicking.
- If a story schedules timers on mount, return a cleanup to clear them.

## Scroll testing

- Use named constants for scroll thresholds (e.g., `SCROLL_TOLERANCE = { TOP: 50, BOTTOM: 200 }`).
- Extract repetitive scroll calculations into helpers.
- The `matchMedia` mock in `packages/components/.storybook/vitest.setup.ts` forces `prefers-reduced-motion: reduce` to `true`, making scroll operations instant.

## End-to-end tests

- Use `127.0.0.1`, not `localhost`, for local URLs.
- Never hardcode port 4173; import `svelteKitBaseURL` from `playwright.config.ts`.
- Shared in-memory database: use `test.describe.configure({ mode: 'serial' })`.
- Make test data unique (timestamp suffix) to avoid collisions.
- Wait for form readiness via `data-can-submit` and assert `toBeEnabled()`.
- Sequential click-then-wait: click first, then wait for navigation (no `Promise.all`).
- Use Zod validation for test endpoint request bodies.

## Accessibility testing

- Disable `landmark-one-main`, `page-has-heading-one`, and `region` rules for isolated component testing.
- Use `withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])` for WCAG coverage.
