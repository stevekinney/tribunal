# Neon Auth Session-Refresh Review Fixes, Fourth Re-check Pass (PR #213)

- `use:enhance` requires its target to be a SvelteKit form action
  (`+page.server.ts`'s `actions`), not a `+server.ts` HTTP handler. It sends
  `accept: application/json` / `x-sveltekit-action: true` and
  `deserialize()`s the response body as a devalue action-result envelope. A
  plain endpoint returning a raw redirect gets silently followed by `fetch`,
  landing on HTML that fails `JSON.parse` and surfaces as an error result
  instead of completing the navigation -- this only shows up with JS
  enabled; the native (no-JS) form submission looks identical either way,
  so this class of bug is easy to miss without testing the enhanced path.
- A form's `action="/other-route"` can target a completely different
  route's action than the page the form is rendered on -- the action URL
  alone determines which route's `actions` export runs. A shared
  component's form doesn't need to live on the route it submits to.
- `+page.server.ts` actions still need a co-located `+page.svelte` for any
  real navigation to that route to render something (no-JS fallback, direct
  hit, crawler) -- a "dead" static page deleted for being unreachable via
  the old flow can become genuinely reachable again once the trigger
  changes shape (form vs. link), and should be restored rather than assumed
  still dead.
- When adding an "immediately do X after resuming from idle" side effect
  that's triggered from two different call sites (a generic activity
  listener and a dedicated visibility-change handler), watch for double
  side effects when both conditions overlap (activity resumes exactly when
  visibility also changes). Split the "just record the timestamp" primitive
  from the "record and conditionally act" wrapper so each call site can
  choose whether it also unconditionally acts, rather than letting two
  independent "idle resumed -> do X" paths both fire for the same event.
- A regression test asserting an exact call count across a multi-step
  timer/event sequence (not just "was called at least once") is what
  actually catches a double-invocation bug -- a looser assertion would have
  passed with the bug present.
