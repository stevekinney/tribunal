/**
 * In-process Weft durable-execution engine.
 *
 * Tribunal's web app runs on `@sveltejs/adapter-node` — a single long-lived
 * process — so it hosts the Weft `Engine` directly rather than talking to a
 * separate engine service. There is no `serve()` and no HTTP hop; workflow
 * producers call the engine in-process via a {@link LocalClient}.
 *
 * Topology invariant: run the web app as a SINGLE replica. Two engines on one
 * durable store can double-resume a workflow. `detectSecondInstance` below is a
 * best-effort runtime smoke alarm (warn-only — it does NOT fence), so the hard
 * guarantee must still come from the deployment: one replica + a `Recreate`-style
 * rollout. Horizontal scaling requires moving the engine to a dedicated service
 * (swap `LocalClient` for `HttpClient` + `serve()`); the producer call sites do
 * not change because they depend only on the `WeftClient` interface.
 */
import { Engine } from '@lostgradient/weft';
import type { WeftClient } from '@lostgradient/weft/client';
import { LocalClient } from '@lostgradient/weft/client/local';
import { NeonStorage } from '@lostgradient/weft/storage/neon';
import { assertDurableStorageForRecovery } from '@lostgradient/weft/storage/interface';
import type { Storage } from '@lostgradient/weft/storage/interface';
import { env } from '$env/dynamic/private';

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
 * Build a Weft engine over the given storage, recovering in-flight workflows
 * (recover defaults to `true`). Exposed for tests that drive the real engine
 * with an injected backend.
 *
 * Omits `workflows` while the registry is empty so `Engine.create` applies the
 * branded default registry (see weft#455). Register ported workflows with
 * `engine.registerWorkflows(...)` once there are any.
 *
 * `detectSecondInstance` is a warn-only backstop for the single-replica
 * invariant; it surfaces a `process.emitWarning` if a second engine writes to
 * the same store, but does not prevent it (enforce one replica in infra).
 */
export function createEngine(storage: Storage): Promise<Engine> {
  return Engine.create({ storage, detectSecondInstance: true });
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

async function buildClient(): Promise<WeftClient | null> {
  const storage = resolveDurableStorage();
  if (!storage) {
    return null;
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
