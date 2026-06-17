/**
 * In-process Weft durable-execution engine.
 *
 * Tribunal's web app runs on `@sveltejs/adapter-node` — a single long-lived
 * process — so it hosts the Weft `Engine` directly rather than talking to a
 * separate engine service. There is no `serve()` and no HTTP hop; workflow
 * producers call the engine in-process via a {@link LocalClient}.
 *
 * Topology invariant: run the web app as a SINGLE writer over the durable store.
 * Two engines on one store could double-resume a workflow, so single-writer
 * ownership is enforced at TWO layers:
 *
 *   1. `ownership: 'lease'` (weft#470) — the HARD guarantee. At boot the engine
 *      acquires a storage-keyed lease before recovering, renews it on a
 *      heartbeat, releases it on dispose, and FENCES every durable write on the
 *      lease epoch. A deposed zombie engine's writes lose a CAS against the
 *      successor's newer epoch and the engine halts to avoid split-brain. A
 *      rolling deploy becomes a clean handoff: the incoming instance parks (up to
 *      {@link LEASE_WAIT_TIMEOUT}) until the outgoing one releases or its lease
 *      expires, so the two never recover concurrently.
 *   2. `detectSecondInstance: true` — a fast warn-only liveness smoke alarm. It
 *      does NOT fence (the lease does that); it just surfaces a misconfigured
 *      second instance via `process.emitWarning` sooner than waiting for a lease
 *      CAS failure to manifest. Cheap defense-in-depth, kept alongside the lease.
 *
 * Horizontal scaling still requires moving the engine to a dedicated service
 * (swap `LocalClient` for `HttpClient` + `serve()`); the producer call sites do
 * not change because they depend only on the `WeftClient` interface.
 *
 * Operators should monitor for the `WeftEngineLeaseLostWarning`
 * (`process.emitWarning`) the engine emits when a lease renewal fails or it is
 * deposed — it signals that more than one instance is contending for the store.
 */
import { Engine } from '@lostgradient/weft';
import type { Duration } from '@lostgradient/weft';
import type { WeftClient } from '@lostgradient/weft/client';
import { LocalClient } from '@lostgradient/weft/client/local';
import { NeonStorage } from '@lostgradient/weft/storage/neon';
import { assertDurableStorageForRecovery } from '@lostgradient/weft/storage/interface';
import type { Storage } from '@lostgradient/weft/storage/interface';
import { env } from '$env/dynamic/private';
import { installationSyncWorkflow } from './workflows/installation-sync.js';
import { pullRequestOrchestratorWorkflow } from './workflows/pull-request-orchestrator.js';

/**
 * Lease handoff window — how long a BOOTING instance waits to acquire the
 * ownership lease before failing. Distinct from `leaseTtl` (default 30s), which
 * bounds takeover after the incumbent STOPS renewing.
 *
 * 60s comfortably covers the crash/kill case: a predecessor that died or hung
 * stops renewing, its lease lapses after the 30s TTL, and the successor acquires
 * well within 60s. It does NOT, however, guarantee a rolling deploy where the
 * OUTGOING instance stays alive and keeps renewing through a >60s overlap — there
 * the successor would time out acquiring. A clean handoff relies on the outgoing
 * process disposing the engine (which releases the lease) promptly on shutdown;
 * if deploy overlap can exceed 60s, raise this above the max expected overlap.
 * The lazy webhook path tolerates a transient acquisition failure (getWeftClient
 * does not cache a rejected build; the webhook returns 500 → GitHub retries).
 */
const LEASE_WAIT_TIMEOUT: Duration = '60s';

/**
 * Storage isolation: Weft's `NeonStorage` owns a single `kv` table in whatever
 * database its URL points at. It MUST NOT share a database/schema with
 * Tribunal's Drizzle tables — drift detection would flag `kv` (red CI) and a
 * `drizzle-kit push` could drop it (destroying live workflow state). So we read
 * a dedicated `WEFT_DATABASE_URL`, never `DATABASE_URL`.
 */
function getDatabaseUrl(): string | undefined {
  return env.WEFT_DATABASE_URL || undefined;
}

function isProduction(): boolean {
  return env.NODE_ENV === 'production';
}

/**
 * The durable workflow definitions registered on the engine, keyed by their
 * workflow `name`. The producers (`signalPullRequestEvent`,
 * `enqueueInstallationSync`) dispatch to these names via `startOrSignal`.
 */
const WORKFLOWS = {
  'pull-request-orchestrator': pullRequestOrchestratorWorkflow,
  'installation-sync': installationSyncWorkflow,
} as const;

/**
 * Build a Weft engine over the given storage, recovering in-flight workflows
 * (recover defaults to `true`). Exposed for tests that drive the real engine
 * with an injected backend.
 *
 * The ported workflow definitions ({@link WORKFLOWS}) are registered through the
 * `Engine.create({ workflows })` option so the producers' `startOrSignal`
 * dispatches resolve to a real run instead of throwing
 * `WorkflowNotRegisteredError`. 0.5.0 made `LocalClient` generic over the
 * engine's registry (weft#585), so the branded engine `Engine.create` returns is
 * assignable to `new LocalClient(engine)` with no cast — the canonical
 * `Engine.create({ workflows }) → new LocalClient(engine)` topology type-checks
 * directly. (Pre-0.5.0 we had to call `registerWorkflows` for its side effect and
 * keep a default-typed reference to dodge the brand mismatch.)
 *
 * `ownership: 'lease'` (weft#470) enforces single-writer ownership at the storage
 * layer — the hard guarantee behind the single-writer topology invariant. The
 * lease is acquired on this `Engine.create()` boot path (its standard acquisition
 * boundary) before recovery, so two instances never recover concurrently.
 *
 * `detectSecondInstance` remains a fast warn-only liveness alarm layered on top
 * of the lease (it does not fence; the lease does).
 *
 * The scheduler's timer-polling loop now auto-starts on the default recovery path
 * (weft#586 — fixed in 0.5.0), so `ctx.sleep(...)` durable timers (the sync
 * debounce and the orchestrator's debounce/idle-timeout) fire without an explicit
 * `engine.scheduler.start()`. `engine[Symbol.asyncDispose]()` stops it and
 * releases the lease on shutdown.
 */
export function createEngine(storage: Storage) {
  // Return type is intentionally inferred: Engine.create({ workflows }) returns a
  // registry-BRANDED Engine<R>, which is what LocalClient now accepts (weft#585).
  // Annotating `Promise<Engine>` would widen it back to the default registry and
  // drop the brand, reintroducing the very mismatch 0.5.0 fixed.
  return Engine.create({
    storage,
    workflows: WORKFLOWS,
    ownership: 'lease',
    leaseWaitTimeout: LEASE_WAIT_TIMEOUT,
    detectSecondInstance: true,
  });
}

// Warn at most once per process when production runs with no durable store, so
// the misconfiguration is loud in logs without throwing on every dispatch.
let warnedMissingProductionUrl = false;

/**
 * Resolve the durable storage backend, or `null` when none is configured.
 *
 * When `WEFT_DATABASE_URL` is set we build `NeonStorage` (asserted
 * recovery-capable). When it is unset we return `null` in *every* environment —
 * the engine stays unbuilt and producers run log-only.
 *
 * Crucially, a missing URL never throws: a configuration gap must not turn into a
 * per-dispatch rejection, which webhook handlers translate into 500s (and GitHub
 * retries). Instead, a missing URL in production is surfaced as a loud one-time
 * boot warning. A genuine *build* failure (URL set but Neon unreachable) still
 * rejects — that is a transient error worth a 500 + GitHub retry, distinct from
 * "no engine configured".
 */
export function resolveDurableStorage(): Storage | null {
  const databaseUrl = getDatabaseUrl();
  if (databaseUrl) {
    const storage = new NeonStorage({ url: databaseUrl });
    assertDurableStorageForRecovery(storage);
    return storage;
  }
  if (isProduction() && !warnedMissingProductionUrl) {
    warnedMissingProductionUrl = true;
    console.error(
      '[weft] WEFT_DATABASE_URL is not set in production: durable workflow dispatch is DISABLED (producers run log-only). Set it to enable the engine.',
    );
  }
  return null;
}

// Module-level singletons: one client per process, built lazily on first use.
// Memoized only on SUCCESS — a rejected build (e.g. transient Neon failure on
// the first dispatch) is NOT cached, so a later dispatch retries cleanly instead
// of the whole process being poisoned until restart.
let clientPromise: Promise<WeftClient | null> | undefined;

// Warn at most once when the durable engine activates in production while the
// documented pre-production hardening gates are still open (WEFT_MIGRATION_PLAN.md
// §4.2 + §7). This is the mechanical "documentation is not a guard" signal — it
// makes activating WEFT_DATABASE_URL before the gates close LOUD at runtime,
// without a hard refusal. (A hard refusal behind an explicit enablement flag is
// the stronger option recorded as a deploy decision in the migration plan.)
let warnedProductionGatesOpen = false;

async function buildClient(): Promise<WeftClient | null> {
  const storage = resolveDurableStorage();
  if (!storage) {
    return null;
  }
  if (isProduction() && !warnedProductionGatesOpen) {
    warnedProductionGatesOpen = true;
    console.error(
      '[weft] Durable engine ACTIVATED in production (WEFT_DATABASE_URL set). ' +
        'Single-writer ownership (lease fencing) and durable finalizers are now wired, ' +
        'but pre-production gates remain — see documentation/WEFT_MIGRATION_PLAN.md §4.2/§7: ' +
        'fire-and-forget sync durability (data-loss on terminal-conflict re-sync) and ' +
        'analyze-activity concurrency hardening. ' +
        'Confirm these are closed before relying on durable execution in production.',
    );
  }
  const engine = await createEngine(storage);
  return new LocalClient(engine);
}

/**
 * Get the shared Weft client (a {@link LocalClient} over the in-process engine),
 * or `null` when no durable store is configured. This is the resolver the GitHub
 * service context carries; producers dispatch through it transport-agnostically
 * and fall back to log-only when it is `null`.
 *
 * Builds lazily on first call and caches only on success. If the build rejects,
 * the rejection is not cached: the next call retries (so a transient storage
 * outage at first dispatch does not permanently disable dispatch).
 *
 * Dispatch is also safe before workflows are ported even when a client IS
 * present: the producers treat `WorkflowNotRegisteredError` as a no-op success,
 * so a live client over an empty registry never fails a webhook. Readiness is
 * gated on workflows being registered, not merely on storage being configured.
 */
export function getWeftClient(): Promise<WeftClient | null> {
  if (!clientPromise) {
    const pending = buildClient();
    clientPromise = pending;
    // Drop the cache if the build fails, so the next call retries rather than
    // reusing a rejected promise.
    pending.catch(() => {
      if (clientPromise === pending) {
        clientPromise = undefined;
      }
    });
  }
  return clientPromise;
}

/**
 * Reset the memoized client. Test-only: lets a suite build, dispose, and clear
 * the singleton between cases so environment changes are observed and instances
 * do not leak across tests.
 */
export function resetWeftClientForTests(): void {
  clientPromise = undefined;
  warnedMissingProductionUrl = false;
}
