# Neon Auth Session-Refresh Review Fixes (PR #213)

- When a client wires an `onSuccess`/lifecycle hook globally at creation time
  (e.g. `createAuthClient`'s `fetchOptions.onSuccess`, applied via better-fetch
  plugins), that hook fires for _every_ request through that client instance,
  not just the call site the developer had in mind. If one call site already
  handles the same side effect explicitly, an implicit global hook races it
  instead of composing with it. Prefer explicit, per-call side effects over an
  implicit hook once more than one call site needs different behavior around
  the same event.
- An `AbortController` only cancels the fetch it's actually passed to. If a
  response handler (e.g. an `onSuccess` hook) kicks off its own _separate_,
  unsignaled fetch as a side effect, aborting the outer request does not
  cancel that inner one -- verify by reading the library's source for whether
  hooks are awaited inside the outer call or fired-and-forgotten, don't assume.
  Thread the same signal through every fetch a refresh path can trigger.
- A periodic background refresh that shares an endpoint with a "create/upsert"
  sign-in flow needs an explicit mode split (e.g. a `refreshOnly` flag) so the
  periodic path can only validate and reset expiry, never write profile
  fields another flow (e.g. an OAuth account-connect callback) deliberately
  set. Read-only validation helpers built for one purpose (e.g.
  `hooks.server.ts`'s per-request check) are often exactly the right helper to
  reuse for a second purpose (periodic refresh) instead of writing a new one.
- Gate polling intervals on `document.visibilityState` (skip scheduled ticks
  while hidden, refresh once on `visibilitychange` to visible) when the app
  runs on scale-to-zero infrastructure (Fly `auto_stop_machines` /
  `min_machines_running = 0`); an idle background tab left open otherwise
  polls forever and defeats the cost control.
- Module-level browser-only code (`document.addEventListener`, etc.) invoked
  from inside a Svelte `$effect` does not need to be reimplemented with
  `<svelte:document>` -- that binding is for component-local listeners a
  template reads reactively. A self-contained imperative service (its own
  `start()`/`stop()` pair, like `startNeonSessionRefresh`) is the right shape
  for a plain module function, not a component concern.
- When a test file's `environment` project (vitest `projects` config) runs in
  Node rather than jsdom/happy-dom, guard any `document`/`window` reference in
  the implementation with `typeof document !== 'undefined'`, and stub
  `document` per-test (`vi.stubGlobal('document', {...})`) to exercise the
  guarded branch -- do not assume a DOM global is present just because the
  code will run in a browser at runtime.
