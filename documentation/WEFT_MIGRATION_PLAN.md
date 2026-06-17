# Weft Migration Plan

> Status: **Workflow definitions ported on Weft 0.4.0.** Weft
> ([`@lostgradient/weft`](https://github.com/stevekinney/weft)) is Tribunal's
> durable-execution substrate, replacing the Temporal layer Tribunal inherited
> (dormant and stubbed) from the sibling `depict` codebase. The 0.4.0 release
> resolved 16 of the 19 issues filed during the wiring increment — most
> importantly weft#456 (the `ctx.race` sleep/wait-signal blocker) and weft#458
> (same-tick signal-drop) — which unblocked porting the actual workflow
> _definitions_.
>
> **Done (0.4.0 increment):** dependency upgraded `^0.3.0` → `^0.4.0`; producer
> seams adopt the now-shipped APIs (`isWeftFault`, the `startOrSignal` `outcome`,
> `getHandle`); the **`pull-request-orchestrator`** and **`installation-sync`**
> workflow _definitions_ are ported, registered on the in-process engine, and
> unit/e2e-tested against a real engine; the **PR action-items feature** (schema
>
> - analyze activity + reconciliation) is ported from depict (deterministic
>   summaries, no LLM dependency); the schema is rebuilt-minimal (`workflow_run` is
>   now a thin observability read-model, `pull_request_trigger` dropped); engine
>   cancellation is wired into installation lifecycle teardown; the delivery GUID is
>   threaded into sync dispatch for signal-layer dedup.
>
> **Remaining (pre-production gates):** the fire-and-forget sync durability fix
> (outbox + reconciler, or claim-after-enqueue) is a HARD prerequisite before
> enabling `WEFT_DATABASE_URL` in production (§4.2); single-replica deployment
> enforcement (`ownership: 'lease'` — weft#470 — evaluated, deferred as a deploy
> decision); and a durable `finalizer` once a sandbox-holding activity exists
> (weft#446 — no external-resource activity in Tribunal today).
>
> **0.4.0-resolved upstream issues:** 446–453, 455, 458, 465–470 shipped. Newly
> filed during this increment: weft#583 (`StartOrSignalOutcome` not exported),
> weft#584 (`ctx.race` does not abort a losing `ctx.run` branch — drove the
> analyze activity's head-SHA generation fence), weft#585 (`LocalClient` rejects a
> branded engine).

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
  engines on one durable store can double-resume a workflow). The engine enables
  Weft's `detectSecondInstance` backstop — a warn-only runtime smoke alarm that
  emits a `process.emitWarning` if a second instance writes to the same store.
  That is **liveness, not fencing**: it does not prevent duplicate execution, so
  the hard guarantee MUST still come from infrastructure (one replica + a
  `Recreate`-style rollout). This is a prerequisite before enabling
  `WEFT_DATABASE_URL` in production.

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
  engine.ts   # resolveDurableStorage / createEngine / getWeftClient over NeonStorage
              # (reads WEFT_DATABASE_URL, NOT DATABASE_URL — see Storage isolation)
```

`github-context.ts` puts a **resolver** on the context —
`resolveWeftClient: getWeftClient` — rather than a resolved client. The engine is
built **lazily on the first dispatch**, not at module load, so web-app startup
never blocks on `Engine.create` + `recoverAll()`. `getWeftClient` builds the
client once and memoizes it **only on success** — a rejected build (transient
Neon outage on first dispatch) is not cached, so a later dispatch retries instead
of the process being poisoned until restart. It returns `null` when no
`WEFT_DATABASE_URL` is set. Workflow definitions register on the engine via
`engine.registerWorkflows(...)` once they are ported.

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
`pull-request-orchestrator:{repo}:{pr}` and a per-event `signalId` derived from
the GitHub delivery GUID. All six PR webhook handlers thread `context.deliveryId`
as `eventId`, so a 500-and-retry of a delivery dedups to one signal (orchestrator
deliveries are claimed only after a successful handler, so the retry path
matters). `signalPullRequestClosed` `signal`s the running run and treats
`WorkflowNotFoundError` as success.

**Still to port:** the orchestrator _workflow definition_ (sliding debounce,
supersede-on-new-event, idle timeout). Blocked on `ctx.race(sleep|waitForSignal)`
(weft#456) — see §6.

### 4.2 Installation sync (wired)

`packages/github/src/sync/index.ts` — `enqueueInstallationSync` now
`startOrSignal`s `installation-sync` with id `github:installations:{id}:sync`. Its
`signalId` is the caller's stable `deliveryId` (the GitHub delivery GUID) when
present so retries/redeliveries dedup, falling back to a fresh UUID only for
distinct manual intents. (Webhook handlers don't thread the GUID down yet — noted
as a `TODO(weft)` at the call sites; GitHub redeliveries are already deduped
upstream by `claimWebhookDelivery`.) The `installation-sync` workflow definition
is still to port.

> [!WARNING]
> **Fire-and-forget durability gap — must close before porting the sync
> workflow.** The installation webhook delivery is claimed (`claimWebhookDelivery`)
> _before_ the handler runs, and the handler enqueues the sync fire-and-forget
> (it must return inside GitHub's ~10s timeout; awaiting a repo-provisioning sync
> would regress latency). So a failed enqueue after the delivery is claimed is
> lost — a GitHub redelivery gets deduped away. This is **inert today** (the
> workflow isn't ported, so the producer is a no-op `started`), and the handler
> now logs an `error` status rather than dropping it silently. Before the
> `installation-sync` workflow ports, the enqueue must become recoverable: an
> outbox row + reconciler, or claim-after-enqueue.

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

### Second pass (2026-06-09): audit of the wiring against the 0.3.0 dist

A follow-up audit of the integration (producers, e2e tests, `NeonStorage`
source, client/engine type surface) surfaced six more gaps, each verified
against the shipped `dist/` before filing:

| #                                                     | Kind        | Summary                                                                                              | Why Tribunal needs it                                                                                                                                 |
| ----------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| [465](https://github.com/stevekinney/weft/issues/465) | enhancement | `HttpClient` erases typed error codes (`code: 'HttpClientError'` + coarse `faultCode`)               | producers branch on `WorkflowNotFoundError`/`WorkflowNotRegisteredError`; the promised LocalClient→HttpClient swap would silently break both branches |
| [466](https://github.com/stevekinney/weft/issues/466) | enhancement | `startOrSignal` outcome: report started-new-run vs signalled-existing                                | the `workflow_run` read-model (§4.5) + producer logging ("started or signaled — doesn't distinguish")                                                 |
| [467](https://github.com/stevekinney/weft/issues/467) | enhancement | `client.getHandle(id)` to re-attach a `ClientHandle` to an existing run                              | fire-and-forget producers discard handles; tests/operator surfaces hand-roll `client.get(id)` polling loops                                           |
| [468](https://github.com/stevekinney/weft/issues/468) | enhancement | `NeonStorage` configurable schema/table (hardcoded `public.kv`)                                      | would let Weft share the app database in a `weft` schema — one secret, one point-in-time-restore line (§3/storage isolation)                          |
| [469](https://github.com/stevekinney/weft/issues/469) | enhancement | `NeonStorage.batch()` issues one query per operation — O(keys) sequential round trips per checkpoint | engine is in-process: `startOrSignal` persistence latency sits on the webhook response path                                                           |
| [470](https://github.com/stevekinney/weft/issues/470) | enhancement | Lease-fenced single-writer ownership over shared storage                                             | removes the every-deploy-is-`Recreate` downtime cost of the in-process topology (remaining item 4)                                                    |

## 7. What's done vs. remaining

**Done (0.4.0 increment):**

- `@lostgradient/weft` upgraded `^0.3.0` → `^0.4.0` in `applications/web` and
  `packages/github`. Producer seams adopt the shipped APIs: `isWeftFault` replaces
  the `isWeftErrorLike(e) && e.code === …` pattern; `startOrSignal` returns a
  handle whose `outcome` (`'started' | 'signalled'`) is propagated; the sync e2e
  uses `getHandle(id).result()`.
- **Workflow definitions ported and registered** on the in-process engine
  (`createEngine` → `registerWorkflows`): `pull-request-orchestrator` (sliding
  debounce + supersede + idle timeout + final-analysis-on-close, via
  `ctx.race([run, sleep, waitForSignal])`) and `installation-sync` (leading-sleep
  debounce + drain race). No `continueAsNew` — the checkpoint model bounds state.
- **PR action-items feature** ported from depict into
  `applications/web/src/lib/server/weft/action-items/`: GraphQL conversation
  fetch, derivation keying, reconciliation (preserves human edits), PR-body
  writeback, persisted via the `@tribunal/github/pull-requests/action-items`
  repository layer. LLM rewrite dropped in favour of `deterministicSummary` (no
  Anthropic dependency). A head-SHA **generation fence** guards stale writes
  (weft#584).
- **Schema rebuilt-minimal** (§4.5): `workflow_run` reduced to a thin
  observability read-model (Temporal-era execution columns dropped);
  `pull_request_trigger` dropped entirely; action-item tables restored to the
  source schema (migration `0023`). Migration verified applying in PGlite.
- **Cancellation** wired: installation lifecycle teardown calls
  `client.cancel(workflowId)` before reconciling the local row; delivery GUID
  threaded into sync dispatch for signal-layer dedup.
- Tests: `@tribunal/github` green (299); web server suite green (347); database
  suite green (93 + migration test); workflow-definition + activity-helper unit
  tests against a real engine. `TODO(weft#NN)` seams refreshed.

**Remaining (pre-production gates, not code-blocking):**

1. **Fire-and-forget sync durability** (§4.2) — outbox + reconciler or
   claim-after-enqueue. HARD prerequisite before enabling `WEFT_DATABASE_URL` in
   production. The GUID threading added now is defense-in-depth, not the fix.
2. **Single-replica enforcement** — one web replica + `Recreate` rollout, OR
   adopt `ownership: 'lease'` (weft#470) as a deliberate deploy-semantics change
   (evaluated, deferred — see weft#585's branded-engine note before wiring it).
3. **Durable finalizer** (weft#446) — wire `ctx.setFinalizerState` + a
   definition-level `finalizer` once a sandbox-holding activity exists. None do
   today (analyze/sync touch only DB + GitHub).
4. **Review-agent dispatch** (`+server.ts`) — a separate future feature, still a
   logged no-op stub.

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
