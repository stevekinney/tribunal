# Weft Migration Plan

> [!IMPORTANT]
> This document is historical migration context for the earlier in-process Weft
> topology. Current production deployment uses the separate `applications/engine`
> service described in `documentation/ARCHITECTURE.md` and
> `documentation/deployment/containers.md`. Do not set `WEFT_DATABASE_URL` on the
> web service; it belongs only on the engine service.

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
> **0.5.0 increment (this change):** upgraded to `^0.5.0`, which shipped fixes for
> every issue filed during the 0.4.0 port. The four consumer-side workarounds were
> removed: the explicit `engine.scheduler.start()` (weft#586 — the scheduler now
> auto-starts on the recovery path), the `registerWorkflows`-then-keep-default-type
> dance (weft#585 — `Engine.create({ workflows }) → new LocalClient(engine)` now
> type-checks directly), and the local `NonNullable<ClientHandle['outcome']>`
> derivation (weft#583 — `StartOrSignalOutcome` is now exported). The head-SHA
> generation fence is KEPT: weft#584 now cooperatively aborts a losing `ctx.run`
> race branch, but that is best-effort and does not catch a same-commit supersede,
> so the fence covers supersede-by-newer-push only. Pre-production gates advanced:
> `ownership: 'lease'` (weft#470) is wired in `createEngine` for hard storage-layer
> single-writer fencing (gate fully CLOSED), and a durable `finalizer` (weft#446)
> reconciles a stranded `installation-sync` status on cancel/timeout (the
> perpetual-spinner case CLOSED; a generation-token hardening for the
> finalizer/success-write race remains tracked below).
>
> **Remaining (pre-production gates):** the fire-and-forget sync durability fix
> (outbox + reconciler, or claim-after-enqueue) is a HARD prerequisite before
> enabling `WEFT_DATABASE_URL` in production (§4.2); a durable per-attempt
> generation token for installation-sync so the finalizer's `failed` and the
> activity's success `idle` write cannot race to a wrong last-writer (§7 item 3 —
> the stranded-spinner case is closed, this hardening is not); and analyze-activity
> concurrency hardening (the same-commit supersede gap and full-body overwrite,
> §7 item 5).
>
> **Upstream issues — all resolved.** 0.4.0 shipped 446–453, 455, 458, 465–470.
> 0.5.0 shipped weft#583 (`StartOrSignalOutcome` not exported), weft#584
> (`ctx.race` does not abort a losing `ctx.run` branch), weft#585 (`LocalClient`
> rejects a branded engine), and weft#586 (`Engine.create` does not start the
> scheduler). No open issues remain against `stevekinney/weft`.
>
> **0.6.0 bump (version-only for Tribunal).** Upgraded `^0.5.0` → `^0.6.0`. 0.6.0
> adds an `Engine.create({ startScheduler })` option (weft#590) that decouples the
> durable-timer poller from `recover`, for hosts that pass `recover: false` and
> own their `recoverAll()`. It defaults to `recover !== false`, so it is a no-op
> for Tribunal: `createEngine` uses the default `recover: true` path and the
> scheduler already auto-starts. No code change — just the version. (weft#590 was
> filed from the sibling `agent-bureau`, which DOES use the `recover: false`
> host-owned-recovery topology; Tribunal does not.)

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
- **Cost (accepted):** the web tier must run as a **single writer** over the
  durable store (two engines could double-resume a workflow). As of the 0.5.0
  increment this is enforced at the storage layer by `ownership: 'lease'`
  (weft#470) — the engine fences every durable write on its lease epoch and halts
  a deposed instance, so duplicate execution is prevented, not merely warned about
  (see §7 item 2). `detectSecondInstance` is retained as a fast warn-only liveness
  alarm layered on top (it does not fence; the lease does). Infra-level
  single-instance enforcement (one replica + a `Recreate`-style rollout) remains
  good practice but is no longer the _only_ guarantee.

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

> [!WARNING] Enabling `WEFT_DATABASE_URL` in production is gated.
> The durable engine only builds when `WEFT_DATABASE_URL` is set, so the gates
> below are inert until an operator takes that deliberate step. To make the risk
> mechanical (not just documentation — the review committee's point), the engine
> emits a loud one-time `console.error` when it activates in production with these
> gates open (`buildClient` in `engine.ts`). **Deploy decision still open:**
> whether to harden that warning into a HARD REFUSAL — engine build throws in
> production unless an explicit `WEFT_PRODUCTION_ENABLED` flag is set, forcing a
> two-step opt-in. Deferred to the production-enablement increment as a deploy
> call, not wired now (it changes deploy semantics and is moot while the gates
> below are open).

**Remaining (pre-production gates, not code-blocking):**

1. **Fire-and-forget sync durability** (§4.2) — outbox + reconciler or
   claim-after-enqueue. HARD prerequisite before enabling `WEFT_DATABASE_URL` in
   production. The GUID threading added now is defense-in-depth, not the fix.
   This also covers the `StartOrSignalConflictError` terminal-conflict re-sync:
   today it surfaces as a loud error (not silently dropped), but a completed sync
   under a stable id blocks the next dispatch — the outbox/reconciler (or a
   restart-capable start-or-signal once weft#452's remaining slice ships) closes
   the data-loss window.
2. **Single-replica enforcement** — ✅ **CLOSED (0.5.0).** `createEngine` opts into
   `ownership: 'lease'` (weft#470): the engine acquires a storage-keyed lease
   before recovery, renews it on a heartbeat, fences every durable write on the
   lease epoch, and halts a deposed instance rather than writing — a hard
   storage-layer guarantee, not a deployment promise. `detectSecondInstance`
   stays as a fast warn-only liveness alarm. `leaseWaitTimeout` (60s) bounds
   boot-time wait; it yields a clean rolling-deploy handoff ONLY when the outgoing
   instance disposes (releasing the lease) or its lease expires within 60s — a
   longer live overlap times out the incoming engine, which the lazy webhook path
   then handles via failure + GitHub retry. Operators should still keep
   infra-level single-instance enforcement and monitor for the
   `WeftEngineLeaseLostWarning` (`process.emitWarning`).
3. **Durable finalizer** (weft#446) — ◑ **stranded-spinner case CLOSED (0.5.0);
   generation-token hardening REMAINS.** `installation-sync` registers a
   definition-level `finalizer` (`reconcileSyncStatusOnTeardown`) and records
   `ctx.setFinalizerState({ installationId })` on entry; on a cancelled/timed-out
   terminal (lease eviction, lifecycle teardown, timeout) the engine reconciles a
   row still showing this run's `'in_progress'` to `'failed'` (idempotent,
   conditional on `syncStatus = 'in_progress'`). `syncRepositories` checks its
   cooperative `AbortSignal` once, before any side effect, so a run cancelled
   during the debounce never starts. The orchestrator has no DB status row to
   strand, so it has no finalizer yet — it gains one the day a sandbox-holding
   activity is added there.

   _Remaining hard-guarantee gap (tracked in the top "Remaining" list):_
   `refreshInstallationRepositories` writes `'idle'` internally at the end of a
   successful fetch, so a cancel landing while it is mid-fetch can leave a stale
   `'idle'` for a cancelled run (the finalizer's `eq('in_progress')` then matches
   nothing). The no-clobber rests on Weft blocking a fresh same-id run while
   teardown is pending plus the cooperative abort. A durable per-attempt generation
   token (shared by the activity's success write and the finalizer `WHERE`) would
   make it airtight — deferred as it is inert until `WEFT_DATABASE_URL` is set.

4. **Review-agent dispatch** (`+server.ts`) — a separate future feature, still a
   logged no-op stub.
5. **Analyze-activity concurrency hardening** — the analyze activity is correct
   for the single-active-analysis case but has known sharp edges under concurrent
   or rapid analyses. These are inert until `WEFT_DATABASE_URL` is set (the
   activity only runs then), and were surfaced by the review committee:
   - **Same-commit supersede isn't fenced.** The generation fence re-fetches
     GitHub's live head SHA before the write and compares it (GitHub-to-GitHub)
     against the SHA fetched at activity start; a supersede on the _same_ commit
     (a new review comment, a thread resolve, a check completing) does not advance
     the SHA. 0.5.0 now cooperatively aborts a losing `ctx.run` race branch
     (weft#584), which catches most supersedes, but the abort is best-effort — an
     activity past its last abort check, or a same-commit supersede that does not
     even cancel the run, can still write. A durable per-PR generation lease
     (write-conditional on "this generation is current") would fully close it.
   - **Full PR-body overwrite can clobber concurrent edits.** The activity
     rewrites the whole body from the snapshot it fetched at start; a human edit
     or a newer analysis landing mid-flight is overwritten. Re-fetch the body
     immediately before the write and apply the block replacement to the fresh
     body.
   - **`synchronize` is not dispatched to the orchestrator**, so a fenced
     analysis (head advanced) has no guaranteed replacement run for the new head.
     Either dispatch head changes or have a fenced analysis re-arm a debounced
     analysis for the current head.
   - **GraphQL connections are first-page only** (reviews/threads/comments/checks
     truncate at their limits; `StatusContext` classic statuses are ignored).
     Paginate the connections needed for correctness and map `StatusContext`
     failures alongside `CheckRun`.
   - **`upsertActionItems` / `addActionItemSources` issue one query per item.**
     Batch into a single `unnest`/multi-values upsert before a real workload.

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
