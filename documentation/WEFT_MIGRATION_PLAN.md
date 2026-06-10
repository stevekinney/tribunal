# Weft Migration Plan

> Status: **In progress.** This is the plan + first increment of installing
> [Weft](https://github.com/stevekinney/weft) (`@lostgradient/weft`) as
> Tribunal's durable-execution substrate, replacing the Temporal layer Tribunal
> inherited (dormant and stubbed) from the sibling `depict` codebase.
>
> **Done so far:** dependency installed; in-process engine wired into the web
> app (single-replica); the two live producers (PR orchestrator signals,
> installation sync) dispatch through Weft with a log-only fallback; unit + e2e
> tests against a real engine; 13 capability/bug issues filed upstream.
>
> **Not done:** porting the actual workflow definitions (the registries are
> empty), schema reconciliation, and the deployment singleton enforcement.

## 1. Background: how Tribunal got here

Tribunal is a sibling of `depict` — same monorepo shape (Bun workspaces +
Turborepo + SvelteKit + Drizzle + Neon). Depict ran a full **Temporal**
deployment: a separate `applications/workers` app on Fly.io as **eight
processes, one per task queue**, with the web app as a Temporal _client_.

When the code was ported into Tribunal, the entire Temporal layer was **removed
and stubbed**, with `TODO(weft):` breadcrumbs left at every seam, explicitly
anticipating this engine. Per `documentation/ARCHITECTURE.md`, the producers
were disabled: the signal functions `console.log` what they would have sent and
return success; there is no workflow engine and no worker.

So this is **not** a "where might Weft fit" exploration — it is "wire the
already-stubbed durable runtime back in." The seams are concrete (§4).

### The "scheduled for removal" caveat → resolved as "rebuild minimal"

`ARCHITECTURE.md` describes the dormant tables (`workflow_run`,
`pull_request_trigger`, …) as _"scheduled for removal… do not build on them
without first deciding whether they should exist at all."_ That is a sequencing
guard, not a contradiction of the `TODO(weft)` intent. **Decision (made):
rebuild minimal** — see §4.5.

## 2. Weft vs. Temporal (what changes for the port)

| Concept              | Temporal (depict)                                   | Weft (Tribunal)                                                          |
| -------------------- | --------------------------------------------------- | ------------------------------------------------------------------------ |
| Core model           | Replay determinism                                  | Checkpoint of live generator state at each `yield*`                      |
| Determinism rules    | `Date.now()`/`Math.random()` forbidden in workflows | **None** — checkpoint model captures live state                          |
| Activity invocation  | `proxyActivities()` + type import                   | `.activities({...})` + `yield* ctx.run('name', input)`                   |
| Signals              | `setHandler` + `condition`                          | `yield* ctx.waitForSignal(name)` (blocking)                              |
| Coalesce webhooks    | `signalWithStart`                                   | `client.startOrSignal(name, input, { name, payload, signalId }, { id })` |
| Retry classification | `nonRetryableErrorTypes`                            | `RetryPolicy.nonRetryableErrors: string[]` (matches by error `name`)     |
| Unbounded history    | `continueAsNew()`                                   | **Not needed** — checkpoint size is bounded by live state                |
| Human approval       | hand-rolled                                         | native `ctx.review({ artifact, reviewType, reviewers, timeout })`        |
| Periodic work        | Temporal Schedules                                  | `client.schedule()`                                                      |
| Heartbeat liveness   | `heartbeatTimeout`                                  | `visibilityTimeout` + `ctx.heartbeat()`                                  |
| Client/engine split  | client in web, server in Docker, workers on Fly     | in-process engine in the web app (§3)                                    |

The single most consequential point: **Weft has no replay-determinism
constraints**, so depict workflows full of determinism workarounds
(`continueAsNew`, `patched`, deterministic-time helpers) simplify or delete.

## 3. Topology: in-process singleton engine

**Decision (made with the user): run the Weft `Engine` in-process inside the
`@sveltejs/adapter-node` web server, as a single replica.** No separate service,
no `serve()`, no HTTP hop.

- The web app's `adapter-node` build is one long-lived process — it satisfies
  the two real requirements: a durable engine host and multi-day timers that
  survive across requests.
- Producers dispatch via a Weft `LocalClient` wrapping the in-process engine.
  The client is typed as the transport-agnostic `WeftClient` interface, so if
  the web tier ever needs to scale horizontally, swapping `LocalClient` for
  `HttpClient` + a dedicated `serve()` engine service is a config change — the
  producer call sites do not change.
- **Cost (accepted):** the web tier must run as a **single replica** (two
  engines on one durable store can double-resume a workflow). Enforce in
  infrastructure.

### Why not a separate engine service?

An earlier draft proposed `applications/engine` (a dedicated Bun service +
`serve()` + `HttpClient`). Rejected as premature: two of its three "forcing"
constraints didn't actually force it (`serve()`-is-Bun-only was circular — you
only need `serve()` if you split services; multi-day-timers is satisfied by
`adapter-node` itself). The in-process engine is the simplest thing that proves
the concept; the separate service is the documented upgrade path, not v1.

### Implementation (in the web app)

```
applications/web/src/lib/server/weft/
  configuration.ts   # reads WEFT_DATABASE_URL (NOT DATABASE_URL — see §4.5/storage)
  registries.ts      # workflow + activity registries (empty; ported workflows land here)
  engine.ts          # getEngine() / getWeftClient() lazy singletons over NeonStorage
```

`github-context.ts` puts a **resolver** on the context —
`resolveWeftClient: getWeftClient` — rather than a resolved client. The engine is
built **lazily on the first dispatch**, not at module load, so web-app startup
never blocks on `Engine.create` + `recoverAll()`. (`getWeftClient` is the
memoized resolver: it builds the engine once and returns `null` when no
`WEFT_DATABASE_URL` is set.)

**Webhook delivery acceptance is never blocked on the engine**, guaranteed two
ways:

1. When no durable store is configured (`WEFT_DATABASE_URL` unset), the resolver
   returns `null` and producers run log-only.
2. When a client _is_ resolved but the workflow definitions are not ported yet
   (empty registry), `startOrSignal` throws `WorkflowNotRegisteredError` — and
   the producers treat that as a **no-op success**, not a webhook-failing error.

So readiness is gated on workflows being _registered and dispatchable_, not
merely on storage being configured. Enabling `WEFT_DATABASE_URL` before porting
workflows does not regress the webhook path.

### Storage isolation (critical)

Weft's `NeonStorage` creates and owns a single `kv` table
(`key TEXT COLLATE "C" PRIMARY KEY, value BYTEA NOT NULL`). It **must not** share
a database/schema with Tribunal's Drizzle tables: drift detection would flag
`kv` (red CI), and a `drizzle-kit push` could drop it (destroying live workflow
state). So the engine reads a dedicated **`WEFT_DATABASE_URL`** (a separate Neon
branch/database), never `DATABASE_URL`. The `key` column needs `COLLATE "C"` or
NeonStorage throws at boot — point it at a fresh database and let it create the
table.

## 4. The seams

### 4.1 Pull request orchestrator (wired)

`packages/github/src/pull-requests/state/workflow-signals.ts` —
`signalPullRequestEvent` now `startOrSignal`s `pull-request-orchestrator` with id
`pull-request-orchestrator:{repo}:{pr}` and a per-event `signalId` (the GitHub
delivery GUID `eventId`, or a fresh UUID for `manual`); `signalPullRequestClosed`
`signal`s the running run and treats `WorkflowNotFoundError` as success. Webhook
handlers already call these — no handler changes needed for dispatch.

**Still to port:** the orchestrator _workflow definition_ (sliding debounce,
supersede-on-new-event, idle timeout). Blocked on `ctx.race(sleep|waitForSignal)`
(weft#456) — see §6.

### 4.2 Installation sync (wired)

`packages/github/src/sync/index.ts` — `enqueueInstallationSync` now
`startOrSignal`s `installation-sync` with id `github:installations:{id}:sync` and
a per-call `signalId`. The `installation-sync` workflow definition is still to
port.

### 4.3 Repository refresh + installation cancellation (pending)

`repositories/service.ts` (synchronous refresh) and `installations/lifecycle.ts`
(`cancelWorkflows` should `client.cancel(id)` running runs). Durable
cancellation teardown for sandbox-holding workflows is blocked on weft#446.

### 4.4 Error taxonomy → retry policies (maps 1:1)

`error-taxonomy.ts` / `token-errors.ts` error `name`s feed
`RetryPolicy.nonRetryableErrors` on each activity — the direct equivalent of
Temporal's `nonRetryableErrorTypes`. Rate-limit windows feed `initialBackoff`/
`maxBackoff`; liveness uses `visibilityTimeout` + `ctx.heartbeat()`. No new
infrastructure.

### 4.5 Database schema — rebuild minimal (decision made)

Drop the Temporal-era columns. Weft's own storage owns execution state. Plan:
`workflow_run` becomes a thin **observability read-model** (status projection
written by activities/interceptors), not the execution substrate;
`pull_request_trigger`'s relational dedup/debounce/supersede machinery collapses
into Weft `startOrSignal` idempotency + in-workflow debounce — likely reducible
to (at most) an audit record. This is a follow-up migration, sequenced before
the orchestrator workflow is ported.

## 5. Per-queue mapping (depict → Weft)

The nine depict task queues, the Temporal primitives each used, and whether
Tribunal has a corresponding seam. (Derived from a parallel analysis of each
queue against Weft's real type definitions.)

| depict queue                   | Temporal primitives                                                                            | Tribunal seam?                                                                      |
| ------------------------------ | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| **pull-request-action-items**  | `setHandler`×2, `condition`, `CancellationScope.cancel`, sliding debounce                      | **Yes** — `workflow-signals.ts` (the PR orchestrator). Wired §4.1.                  |
| **github-sync**                | `setHandler`, `defineSignal`, `sleep`, `condition`, `continueAsNew`                            | **Yes** — `sync/index.ts` (+ lifecycle/refresh). Wired §4.2.                        |
| **pull-request-review**        | `CancellationScope`, `setHandler`, sandbox lifecycle, `heartbeat`                              | Partial — same `workflow-signals.ts` seam; review-agent is a future feature.        |
| **address-pr**                 | `continueAsNew`, `CancellationScope.nonCancellable`, `workflowInfo`, `heartbeat`, CI-poll loop | Schema seams (`workflow_run`, `pull_request_trigger`); feature not yet in Tribunal. |
| **account-deletion**           | `proxyActivities` + `heartbeat`, batch checkpoint deletion                                     | Indirect — operates on the `workflow_run` data §4.5 reshapes.                       |
| **planning**                   | `setHandler`, `defineSignal`/`defineQuery`, `condition`, `CancellationScope`                   | No direct seam — depict goal-planning feature.                                      |
| **repository-question-answer** | `condition`, `continueAsNew`, `CancellationScope.nonCancellable`, sandbox Q&A                  | No seam — depict-only sandbox feature.                                              |
| **pull-request-dependencies**  | one-shot `proxyActivities`, retry policies, LLM calls                                          | No seam — depict dependency-inference feature.                                      |
| **sandbox-reconciler**         | periodic `sleep`+`continueAsNew` loop, `patched`, `getHandle`                                  | No seam — maps to Weft `client.schedule()` if Tribunal grows sandboxes.             |

**Takeaway:** Tribunal's live seams are exactly the two GitHub-automation queues
(**pull-request-action-items** and **github-sync**) — both now wired. The rest
are depict features Tribunal does not (yet) have; they map cleanly to Weft when
the corresponding feature lands, with the gaps in §6 applied.

## 6. Capability gaps & bugs filed on `stevekinney/weft`

Each was verified against Weft's real type definitions or a running engine
before filing; a `TODO(weft#NN):` note sits at the corresponding seam.

| #                                                         | Kind        | Summary                                                                                       | Blocks                                                            |
| --------------------------------------------------------- | ----------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| [446](https://github.com/stevekinney/weft/issues/446)     | enhancement | Durable (replay-safe) cancellation teardown — `ctx.onCancel`/saga are best-effort             | sandbox-holding workflow cleanup (§4.3)                           |
| [447](https://github.com/stevekinney/weft/issues/447)     | enhancement | `ctx.log` structured workflow-scoped logger                                                   | observability in ported workflows                                 |
| [448](https://github.com/stevekinney/weft/issues/448)     | enhancement | `ctx.waitUntil`/`condition` predicate gate                                                    | debounce/composite-state ergonomics                               |
| [449](https://github.com/stevekinney/weft/issues/449)     | enhancement | `scheduleToCloseTimeout` cross-attempt budget on `ActivityCallOptions`                        | total-time SLA caps                                               |
| [450](https://github.com/stevekinney/weft/issues/450)     | enhancement | `ActivityContext.lastHeartbeatDetails` on retry                                               | resumable batch activities                                        |
| [451](https://github.com/stevekinney/weft/issues/451)     | enhancement | `ctx.workflowType` (and queue) on context                                                     | session/correlation tagging                                       |
| [452](https://github.com/stevekinney/weft/issues/452)     | enhancement | Idempotent re-start when prior run is terminal (`ALLOW_DUPLICATE`)                            | periodic reconciler on stable ids                                 |
| [453](https://github.com/stevekinney/weft/issues/453)     | docs        | Document cooperative activity cancellation (`ctx.race` + `AbortSignal`)                       | supersede semantics                                               |
| [454](https://github.com/stevekinney/weft/issues/454)     | docs        | Document `heartbeatTimeout` → `visibilityTimeout` rename                                      | migration clarity                                                 |
| [455](https://github.com/stevekinney/weft/issues/455)     | enhancement | `Engine.create({ workflows: {} })` returns unbranded engine, breaks `serve()` typing          | engine scaffolding ergonomics                                     |
| **[456](https://github.com/stevekinney/weft/issues/456)** | **bug**     | **`ctx.race`/`ctx.all` reject `sleep`/`waitForSignal` sub-operations (only `ctx.run` works)** | **the orchestrator workflow (debounce, supersede, idle-timeout)** |
| **[457](https://github.com/stevekinney/weft/issues/457)** | **bug**     | **`query()` returns `undefined` for a workflow parked on `waitForSignal`**                    | operator inspection of parked orchestrators                       |
| **[458](https://github.com/stevekinney/weft/issues/458)** | **bug**     | **Same-tick signal after `startOrSignal` can drop the start payload**                         | bursty-webhook coalescing reliability                             |

The three **bugs** (456–458) were all found while building the e2e test against
a real engine — exactly the failures mocked unit tests cannot surface. **456 is
the headline blocker** for porting the orchestrator workflow: every
timer/signal-racing pattern depends on it. Until it ships, the orchestrator
_workflow definition_ cannot be ported (the _wiring_ is done and correct).

## 7. What's done vs. remaining

**Done (this increment):**

- `@lostgradient/weft@0.3.0` installed in `applications/web` and `packages/github`.
- In-process engine + `LocalClient` wired (`src/lib/server/weft/`, `github-context.ts`).
- Both live producers dispatch through Weft with log-only fallback + error handling.
- Unit tests (producers, fallbacks, `WorkflowNotFound`, `WorkflowNotRegistered`
  no-op safety) + e2e tests against a real engine (start-or-signal coalescing,
  signal delivery, completion) for both the PR and sync paths, plus a factory
  test that drives the real `createEngine`/`resolveDurableStorage`/`LocalClient`
  module. Full `@tribunal/github` suite green (293 tests); web server suite green
  (343). The engine is built lazily on first dispatch (resolver thunk), so it
  never boots during web-app startup or the test suite.
- 13 issues filed upstream; `TODO(weft#NN)` notes at each seam.

**Remaining:**

1. **Schema rebuild-minimal** (§4.5) — reshape `workflow_run` / drop
   `pull_request_trigger` machinery.
2. **Port the orchestrator + sync workflow definitions** — blocked on weft#456
   for the orchestrator's debounce/supersede; sync can proceed sooner.
3. **Repository refresh + cancellation** (§4.3) — blocked on weft#446 for
   durable teardown.
4. **Singleton enforcement** — single web replica; second-instance detector.
5. **Apply gaps** as upstream issues ship (refactor the `TODO(weft#NN)` seams).

> Engine boot timing is **resolved**: the engine builds lazily on first
> dispatch (via the `resolveWeftClient` thunk), so web-app startup is not coupled
> to `recoverAll()`. The first webhook that dispatches pays the one-time
> build/recover cost; all later calls reuse the memoized engine.

## 8. Verification

```bash
# from packages/github:
bunx tsc --noEmit                                    # github types
bunx vitest run -c vitest.configuration.ts           # 291 tests (incl. Weft wiring + e2e)

# from applications/web:
bun run check                                        # svelte-check, 0 errors
bun run test:unit:server                             # 338 tests
```
