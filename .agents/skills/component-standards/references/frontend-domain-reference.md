# Frontend Domain Reference

This reference consolidates guidance from the previous frontend micro-skills into
the canonical `component-standards` domain pack.

## Svelte reactivity and runes

- Prefer `$state`, `$derived`, and `$bindable` over effect-heavy state bridges.
- Avoid mutation in derived expressions; keep derived values pure.
- Use `untrack()` for non-reactive bookkeeping and avoid read/write effect loops.

## Attachments and DOM lifecycle

- Use `{@attach}` for lifecycle-bound DOM behavior.
- Always provide cleanup for timers, observers, and EventSource handlers.
- After async boundaries, guard DOM operations with connection checks.

## SvelteKit routes and forms

- Use form actions for mutations and route load functions for data access.
- Use `depends(...)` and explicit invalidation for post-action consistency.
- Stream non-critical data and provide pending/failed UI boundaries.

## Frontend testing

- Browser behavior belongs in `.svelte.test.ts` tests.
- Always cleanup render state in browser tests.
- Avoid fixed sleeps in E2E; wait on URL/network/visible states.
- Keep stories deterministic and cover keyboard + a11y interaction.

## Review editor specifics

- Thread/selection popovers require strict state invalidation.
- Capture values at schedule time for timer-safe async behavior.
- Keep anchor sync logic draft-aware and readonly-safe.
