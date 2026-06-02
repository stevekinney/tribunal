---
paths:
  - src/lib/components/**
  - src/lib/utilities/**
---

# Svelte 5 Patterns

Before editing paths in this rule, load `$component-standards` and apply its constraints.
For code examples, see `component-standards` references.

## Reactivity

- `$derived` is read-only. Use `$state` + `$effect` when mutation is needed.
- Use `$derived(expression)` for simple expressions, `$derived.by(() => { ... })` for multi-statement logic. Never use `$derived(() => ...)` -- this creates a derived that holds a function, not the computed result.
- No mutations in `$derived` blocks. Use non-mutating alternatives like `[...array].sort()` or `array.toSorted()`.
- `$effect` tracks reads. Avoid read+write loops; use `untrack()` or non-reactive `let` for bookkeeping.
- Getter functions for selective dependency tracking: pass a getter instead of a value to defer reads inside `untrack()`.
- Async safety: after `await`, check `element.isConnected` before touching DOM references.
- Cleanup: clear all timers/observers in `$effect` cleanup.
- Reset state on re-run: when an `$effect` handles streamed data, reset loading/ready state at the start since SvelteKit reuses components during client-side navigation.
- Do not recompute absolute timestamps from stale `data` props in `$derived`; use `$state` and update only when relevant form responses provide new data.

## Streamed data with `<svelte:boundary>`

- With `experimental.async` enabled, use `<svelte:boundary>` with `await` expressions in markup instead of `$effect` + cancellation.
- Declare `pending` and `failed` snippets for loading/error states.
- No manual cancellation or `isLoading` state needed; navigation reuse is handled automatically.

## Server-Sent Events (SSE)

- Always close `EventSource` in the `$effect` cleanup function.
- EventSource auto-reconnects on error; handle reconnection UI state.
- Parse events defensively with try/catch.
- Track the ID/URL as a dependency to reconnect when it changes.
- Handle all emitted event types and cap in-memory buffers to avoid unbounded growth.
- If parsing SSE manually, handle CRLF line endings, `data:`/`event:` lines with or without a space, multi-line `data:` concatenation, empty data frames, and a final `TextDecoder` flush.

## Interval-based countdown

- Store interval ID in `$state` if external cancellation is needed.
- Clear interval both in cleanup and when countdown reaches zero.
- Check conditions before starting the interval; provide a cancel function.

## Async callback loading state

- Guard against double-submission with an early return check.
- Use `try/finally` to ensure loading state is cleared even on error.
- For `SvelteMap`/`Set` mutation, create new instances to trigger reactivity.
- Pass `aria-busy={isLoading}` to buttons for accessibility.

## Collections

- Count alone cannot detect append versus prepend; track stable IDs.
- Pre-compute filtered lists so `data-count` matches rendered items.

## Input handling

- Debounced editors: read latest content from the editor API at submit time.
- IME composition: check `event.isComposing` before Enter-to-submit.
- Validate consistently across all input paths (paste, drop, file picker).
- Do not use `bind:value={getter, setter}`; Svelte expects a writable store or local variable. Use `$bindable()` or explicit `on:input` handlers instead.
- Do not combine `bind:value`/`$bindable()` with explicit `onChange` callbacks for the same field; choose one data flow to avoid double updates.

## Defensive serialization

- Use `$lib/utilities/stringify` helpers instead of raw `JSON.stringify()`.
- Empty string is falsy; use `!== null` when empty string is valid.

## SvelteMap

- Only needed when a `Map` is mutated after creation. Maps recreated in `$derived.by` can be plain `Map`.

## One-time prop reads for forms

- Use `$state(untrack(...))` for primitives, `$state.raw(untrack(...))` for arrays/objects.
- Move derived computations and filtering to load functions; keep `untrack()` for simple value initialization only.

## Two-way binding with `$bindable()`

- Use `$bindable()` instead of bridging with internal state plus effects.
- Eliminates bridge code and allows state to flow naturally through the component tree.

## Resetting `$bindable()` state after navigation

- Wrap the component in a `{#key}` block keyed on derived state to force re-creation after `goto()`.
- Ensures components reflect server state when `$bindable()` internal state gets out of sync.

## Iframe previews

- When writing rendered HTML into an iframe, set a `sandbox` attribute and avoid `allow-scripts`. Treat preview HTML as untrusted unless it has been sanitized.

## Async form submission: snapshot before submit

- Capture submitted values at submit time, not after the response arrives, to prevent race conditions.
- Deep copy objects in snapshots (use `.map(object => ({ ...object }))`, not spread on arrays of objects).
- Do not pass wrapper functions to Form's `onsubmit`; capture snapshots via a container submit event listener during the capture phase.

## Anti-patterns

- `$derived(() => ...)` with a function argument (holds a function, not a result).
- Mutations inside `$derived` or `$derived.by()`.
- Read+write loops in `$effect` without `untrack()`.
- Missing `element.isConnected` check after `await` in effects.
- Missing cleanup for timers, observers, or `EventSource` in `$effect`.
- Using `$derived` for absolute timestamps that should only update on specific events.
- Bridge pattern (`internal state` + dual `$effect` sync) instead of `$bindable()`.
