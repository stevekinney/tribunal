---
applyTo: '**/*.test.ts,**/*.svelte.test.ts,**/*.spec.ts,**/test/**,**/*.stories.ts'
---

# Testing Review Heuristics

These cover the Tribunal monorepo: the SvelteKit app in `applications/web` and the shared `@tribunal/*` packages -- `agents`, `cost`, `database`, `github`, `review-core`, `sandbox`, `test`, `typescript`. Use `@tribunal/*` package names in tests; that is the only workspace namespace. The design system is a third-party dependency, `@lostgradient/cinder`.

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

## Component tests

There is no Storybook in this repository -- no configuration, no dependency, no
stories. Components are verified with browser component tests and Playwright;
see `documentation/TESTING.md`. Earlier revisions of this file described a
Storybook workflow inherited from another repository.

- A component test lives alongside its component as `*.svelte.test.ts`, and runs in the client project (`test:unit:client`). A plain `*.test.ts` runs in the server project (`test:unit:server`).
- Call `cleanup()` in `afterEach`.
- Use `behavior: 'auto'` (not `'instant'`) for `scrollTo()` calls. Valid `ScrollBehavior` values: `'auto'` and `'smooth'`.
- Use deterministic IDs and timestamps in test data factories — avoid module-level counters.
- Cover every enum and union value the component accepts.
- Use `expect.element()` or `waitFor()` with assertions inside the callback instead of custom polling loops.
- For refresh flows, wait for the stale badge or enabled button state before clicking.
- If a component schedules timers on mount, clear them in its cleanup.

## Scroll testing

- Use named constants for scroll thresholds (e.g., `SCROLL_TOLERANCE = { TOP: 50, BOTTOM: 200 }`).
- Extract repetitive scroll calculations into helpers.
- A test that depends on reduced motion must stub `matchMedia` itself; there is no global mock forcing `prefers-reduced-motion: reduce`. `authenticated-layout.svelte.test.ts` shows the pattern.

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
