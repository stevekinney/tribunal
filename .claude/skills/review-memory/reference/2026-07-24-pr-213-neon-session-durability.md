# PR 213 — Neon Auth session durability review rounds

## Durable learnings

- Classify vendor SDK errors by which operation phase threw, not just by base error class. `jose`'s JWKS errors split into a fetch/parse phase (infrastructure signal) versus a token-vs-key `kid`-matching phase (must stay invalid-by-default for security).
- An `AbortController` passed to an outer call does not cancel a separate, unsignaled fetch a response hook kicks off as a side effect. Thread the same signal through every fetch a flow can trigger, and verify by reading the library's source for whether hooks are awaited or fired-and-forgotten.
- A client-wide lifecycle hook (e.g. `fetchOptions.onSuccess`) fires for every call through that client instance. Once more than one call site needs different behavior around the same event, split into explicit per-call side effects instead of one implicit global hook.
- A periodic background refresh sharing an endpoint with a create/upsert flow needs an explicit mode split (e.g. `refreshOnly`) so it can validate without ever performing the write.
- Gate scale-to-zero-friendly polling on tab visibility only, not an additional activity-based idle cutoff — the latter lets a session's lease lapse before the underlying token actually expires, and the natural fix (refresh on first activity) races the very user gesture that triggers navigation.
- Coordinate logout across browser tabs with `BroadcastChannel`; a single tab's `AbortController` cannot cancel another tab's in-flight refresh, and a JWT minted before sign-out is still valid there.
- A third-party identity-provider call inside a `use:enhance` submit callback must be timeout-bounded — that callback is awaited before the form's own POST fires, so a stalled (not just rejecting) remote call blocks local logout indefinitely.
- `use:enhance` requires its target to be a `+page.server.ts` form action, not a `+server.ts` endpoint — it `deserialize()`s the response as a devalue action-result envelope, which a raw HTTP redirect doesn't satisfy. This only breaks with JavaScript enabled, so it's easy to miss without testing the enhanced path.
- A `returnTo` redirect parameter must be honored on every path that can reach an "already authenticated" branch, not just the primary sign-in path — a transient-failure retry can land an authenticated user back on `/login` and silently drop their original destination if the load function redirects unconditionally to `/`.
- Re-running a review-triage pass after pushing a fix is not optional busywork: each of five consecutive re-check rounds on this PR surfaced at least one genuinely new finding, not merely a re-flagged already-addressed one.
