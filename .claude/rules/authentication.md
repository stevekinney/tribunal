---
paths:
  - applications/web/src/hooks.server.ts
  - applications/web/src/lib/server/auth/**
  - applications/web/src/lib/auth/**
  - applications/web/src/routes/login/**
  - applications/web/src/routes/logout/**
  - applications/web/src/routes/onboarding/**
  - applications/web/src/routes/auth/**
---

# Authentication patterns

## Hook ordering is a security boundary

Anything in `hooks.server.ts`'s `sequence()` that needs an authenticated user must be sequenced **after every identity-populating handle**, not merely after `authHandle`.

The distinction is load-bearing. The current sequence ends `authHandle, devAuthBypassHandle`, and `devAuthBypassHandle` is what populates the synthetic user when `DEV_AUTH_BYPASS=1`. A short-circuiting handler placed between them sees no authenticated user in exactly the preview environment the bypass exists to serve. Restate this rule if another identity handle is ever added.

A handler placed before the identity handles can answer a request without invoking the downstream `resolve`, so they never run and `event.locals.user` is never populated. The handler is then serving an unauthenticated request while looking like it is serving an authenticated one, and the usual repair — validating a token inside the handler — introduces a second identity path that diverges from the first.

Handlers must consume the locals `authHandle` populates rather than validating a token themselves. Assert the ordering in a test: it is one line in `sequence()`, a later edit can invert it, and there is no other symptom.

## Open redirect prevention

Always use `sanitizeReturnTo()` from `$lib/server/auth/authentication` to validate return URLs before redirecting. This prevents attackers from crafting URLs that redirect users to malicious sites after login.

```typescript
import { sanitizeReturnTo } from '$lib/server/auth/authentication';

// In load function - sanitize URL params
const returnTo = sanitizeReturnTo(url.searchParams.get('returnTo'));
redirect(302, returnTo);

// In form actions - sanitize form data
const returnTo = sanitizeReturnTo(formData.get('returnTo')?.toString() ?? null);
redirect(302, returnTo);
```

Apply this to **all** `returnTo` parameters from:
- URL search params (`url.searchParams.get('returnTo')`)
- Form data (`formData.get('returnTo')`)
- OAuth state (`state.returnTo`)

## Session durability (Neon Auth bridge)

Lessons from hardening the Neon Auth session bridge (`hooks.server.ts`, `$lib/server/auth/neon-session.ts`, `$lib/auth/neon-client.ts`) against transient infrastructure failures and expiry-related logouts.

### Classify vendor SDK errors by which phase threw, not just by error class

When distinguishing a transient infrastructure failure from a genuinely invalid credential using a vendor SDK's typed error hierarchy, group by *which operation* threw, not just by "is this the library's generic base error class." `jose`'s JWKS-loading errors split into two phases: fetching/parsing the key set document itself (`JWKSTimeout`, a bare `JOSEError` for a non-200/unparseable response, `JWKSInvalid` for a 200 response that isn't structurally a key set) versus matching a *presented token's* `kid` against an already-valid, already-parsed key set (`JWKSNoMatchingKey`, `JWKSMultipleMatchingKeys`). Only the first phase is a pure identity-provider infrastructure signal. The second phase involves the presented token's own header and must stay "invalid by default" — a forged `kid` probing for a bypass should never be classified transient just because it superficially resembles a JWKS-loading error.

### Thread `AbortSignal` through every fetch a refresh path can trigger, not just the outer call

An `AbortController` only cancels the fetch it's actually passed to. If a response handler (e.g. a client library's `onSuccess` hook, or a call site that reacts to a request's result) kicks off its own *separate*, unsignaled fetch as a side effect, aborting the outer request does not cancel that inner one. Verify by reading the library's source for whether such hooks are awaited inside the outer call or fired-and-forgotten — don't assume. This matters most for logout/teardown: a session-refresh request in flight when a user signs out, whose own bridge POST resolves afterward, can silently recreate a session the user just ended.

### Prefer explicit per-call side effects over a client-wide lifecycle hook once behavior diverges

A hook wired globally at client construction (e.g. `createAuthClient`'s `fetchOptions.onSuccess`) fires for *every* request through that client instance, not just the call site a developer had in mind. Once more than one call site needs different behavior around the same event (e.g. a sign-in flow that should upsert a user profile vs. a periodic background refresh that must only validate and reset expiry), an implicit global hook races an already-explicit call site instead of composing with it. Split into separate, explicit functions per call site instead.

### Split "refresh" from "create/upsert" when a periodic background job shares an endpoint with a write-heavy user-facing flow

A periodic background refresh that shares an endpoint with a "create/upsert" sign-in flow needs an explicit mode split (e.g. a `refreshOnly` flag) so the periodic path can only validate and reset expiry, never write profile fields another flow (e.g. an OAuth account-connect callback) deliberately set.

### Gate polling on tab visibility, not recent user activity

When a background refresh interval must respect scale-to-zero infrastructure (Fly `auto_stop_machines` / `min_machines_running = 0`), gate scheduled ticks only on `document.visibilityState` (skip while `'hidden'`, refresh once on `visibilitychange` back to `'visible'`). Do **not** add an additional activity-based idle cutoff (tracking pointer/keyboard/scroll events) on top of the visibility gate — it lets the session's lease lapse *before* the underlying token would have actually expired, and the natural fix (refresh immediately on the first activity event after idling) races the very next user gesture, since that gesture can also trigger navigation before the fire-and-forget refresh completes. A visible-but-genuinely-unattended tab polling forever is an accepted, bounded cost; a visible tab silently expiring the user's own session while they're looking at it is the bug this class of code exists to prevent.

### Coordinate logout across tabs with `BroadcastChannel`

A single tab's `AbortController` cannot cancel a *different* tab's in-flight session refresh. A JWT minted before sign-out is still cryptographically valid, so another tab's already-scheduled refresh can complete after `/logout` deletes the shared cookie and silently recreate the session there. Broadcast a logout signal (`BroadcastChannel`) that every tab running a refresh scheduler listens for and tears itself down on, in addition to each tab's own local abort-on-teardown handling.

### Never let local logout block on a third-party identity provider

A `use:enhance` submit callback is awaited before the form's actual POST is dispatched (confirmed via `@sveltejs/kit`'s `runtime/app/forms.js`: `await submit({...})` runs before the request fires). This makes it the correct place to run client-only pre-submission side effects (a cross-tab broadcast, ending a third-party auth session) for a form that must also degrade to a native, no-JS POST. But a third-party call that *stalls* rather than rejecting — not just one that errors — will block local logout indefinitely if awaited unbounded. Bound any such call with a timeout (`Promise.race` against a short deadline) so a stalled or unreachable identity provider can never prevent clearing the app's own session.

### `use:enhance` requires a real form action, not an HTTP endpoint

`use:enhance` sends `accept: application/json` / `x-sveltekit-action: true` and `deserialize()`s the response as a devalue action-result envelope. A plain `+server.ts` endpoint returning a raw HTTP redirect gets silently followed by `fetch` and fails to deserialize as JSON, surfacing an error result instead of completing the navigation. This only shows up with JavaScript enabled — the native (no-JS) form submission looks identical either way — so it's easy to miss without testing the enhanced path specifically. Route any form using `use:enhance` to a `+page.server.ts` action, not a `+server.ts` handler.

### Preserve `returnTo` even on an already-authenticated bounce

`/login`'s load function must read and sanitize `returnTo` even when the visitor turns out to already be authenticated (e.g. a transient infrastructure failure bounced them here on one request, but the retained session cookie is valid again by the time this load runs) — not just redirect unconditionally to `/`. Losing the destination here is invisible in the common case (a fresh sign-in) and only surfaces for this one degraded-path retry, making it easy to miss without a dedicated test.
