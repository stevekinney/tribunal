# Learnings from the TRI-52 operational-endpoints review cycle

Recorded per `AGENTS.md`: when compiling review feedback, record learnings in `documentation/learnings/` and promote them to the relevant rules. Source is the six-round review cycle on [#378](https://github.com/stevekinney/tribunal/pull/378) (TRI-52 — the authenticated `/health/ready` and `/metrics` operational endpoints). Most rounds after the first hardened two async primitives — a coalescing cache and a pre-auth rate limiter — against dependency-failure paths, and the same theme recurred: an observability endpoint is only as available as the least-available dependency in its request path.

## Operational endpoints must minimize their dependency set

- **An endpoint that exists to observe failures must not fail when the things it observes do.** `/health/ready` and `/metrics` initially flowed through session hydration, the dev-bypass database upsert, AND the MCP mount await — so a database or mount incident would take down the very endpoints used to diagnose it. The fix routes operational paths around _every_ identity- or mount-populating handle.
- **"Skip the identity handles" means all of them, and the first one runs first.** The skip was added to `authHandle`, then `devAuthBypassHandle`, then `createMcpHandle`, and finally `e2eHandle` — each a separate review round. `e2eHandle` is sequenced earliest and does its own database-backed session work under `E2E_TEST_MODE`, so it was the easiest to forget and the most consequential to miss. When a cross-cutting bypass is "before hydration," enumerate every handle in `sequence()` that populates identity, not just the one named `auth`.
- **The rate limiter is defense-in-depth, not the primary guard, so it fails open.** Like the public `/health` gate, a Redis outage must not blind the operator; the bearer token remains the guard. But it is still consumed on every request before auth (OPS-002) so a wrong-bearer guess loop is bounded.

## Coalescing a cache over an uncancellable load

A single-flight cache with a TTL is simple until the underlying load can stall (a Postgres driver with no query timeout). The complete resilient shape took several rounds and is now the reference:

- **A per-caller deadline that clears the in-flight entry leaks one load per poll.** Clearing on each timeout means every subsequent poll starts a new (uncancellable) query — during an outage that is unbounded amplification.
- **Never clearing the in-flight entry pins the endpoint forever.** If a wedged load never settles, every future caller coalesces onto it and no fresh load can detect recovery.
- **The resolution is a single in-flight deadline (not per-caller, not never).** An in-flight load unsettled within the window is abandoned once: awaiting callers reject, the entry clears, and the next window re-probes. Concurrent callers within one window still coalesce onto one load — at most one load per window, not one per poll, and not forever.
- **An abandoned load that later resolves must not overwrite a newer result.** Guard the cache write with a generation id captured at load start; a load that is no longer current when it resolves is ignored. Otherwise a stale dependency snapshot can overwrite a fresh one for the full TTL.
- **Clone on every read, including the coalesced in-flight branch.** The cache-hit and cache-miss clone is not enough: two overlapping callers of one in-flight load otherwise share a single mutable object. Return a per-caller `.then(clone)` off the shared promise.
- **A shared/cached promise needs its own no-op `catch`.** When callers attach their handlers as separate `.then` branches a tick later, the shared promise's rejection can surface as unhandled; a defensive `.catch(() => {})` on the stored promise closes that window.

## A pre-auth limiter over a stalling store needs a circuit breaker

- **A `Promise.race` deadline stops _awaiting_ a stalled call; it does not stop _issuing_ new ones.** Because the limiter runs before authentication, an unauthenticated flood during a partial Redis outage can leave one uncancellable queued command per request, exhausting the command queue or memory. While a timed-out command remains unresolved, hold a breaker open: new requests fail open immediately without issuing another command, and it closes when the stalled command settles. This bounds pending commands to one.

## Testing async deadlines

- **With fake timers, attach a rejecting promise's handler before advancing time.** `const p = f(); await advanceTimers(); await expect(p).rejects…` leaves `p` transiently unhandled while the deadline fires, which vitest escalates to a run failure. Attach the assertion (`const rejects = expect(p).rejects…`) before `advanceTimersByTimeAsync`.
- **Run the full `test:coverage` and package suites before pushing, not just the affected files.** The affected-file subset hides coverage-gate regressions (a structurally-unreachable branch dropped line coverage) and cross-package fixture drift (a `deploy-status` fixture mirroring the deploy secret list). Both were caught by CI after a push that the subset had passed.

## Spec-vs-reality reconciliation

- **When an acceptance criterion collides with a load-bearing production decision, re-scope the criterion, not the deployment.** TRI-52's original AC1 ("public `/health` must be dependency-free") conflicted with the TRI-124/TRI-125 `web.toml` decision that the Fly-gated `/health` must probe the database (or a DB-broken Machine gets promoted). The fix was to drop AC1 by owner decision and make TRI-52 the _additive_ authenticated surface, leaving the deep `/health` as the Fly gate.
