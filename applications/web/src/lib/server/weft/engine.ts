/**
 * In-process Weft durable-execution engine.
 *
 * Tribunal's web app runs on `@sveltejs/adapter-node` — a single long-lived
 * process — so it hosts the Weft `Engine` directly rather than talking to a
 * separate engine service. There is no `serve()` and no HTTP hop; workflow
 * producers call the engine in-process via a {@link LocalClient}.
 *
 * Topology invariant: run the web app as a SINGLE replica. Two engines on one
 * durable store can double-resume a workflow. Horizontal scaling of the web tier
 * requires moving the engine to a dedicated service (swap LocalClient for
 * HttpClient + serve()); the producer call sites do not change because they
 * depend only on the `WeftClient` interface.
 */
import { Engine } from '@lostgradient/weft';
import type { WeftClient } from '@lostgradient/weft/client';
import { LocalClient } from '@lostgradient/weft/client/local';
import { NeonStorage } from '@lostgradient/weft/storage/neon';
import { assertDurableStorageForRecovery } from '@lostgradient/weft/storage/interface';
import type { Storage } from '@lostgradient/weft/storage/interface';

import { getWeftConfiguration, type WeftConfiguration } from './configuration';

/**
 * Build a Weft engine over the given storage, recovering in-flight workflows
 * (recover defaults to `true`). Exposed for tests that drive the real engine
 * with an injected backend.
 *
 * Omits `workflows` while the registry is empty so Engine.create applies the
 * branded default registry (see registries.ts / weft#455). Register ported
 * workflows with `engine.registerWorkflows(...)` once there are any.
 */
export function createEngine(storage: Storage): Promise<Engine> {
  return Engine.create({ storage });
}

/**
 * Resolve the durable storage backend, or `null` when none is configured.
 *
 * Production requires the dedicated `WEFT_DATABASE_URL` (Neon, asserted
 * recovery-capable) and throws if it is missing. Non-production with no URL
 * returns `null` — the engine stays unbuilt and producers run log-only — so dev
 * and the test suite do not boot an engine they don't need. A non-production
 * run that *wants* a real engine sets `WEFT_DATABASE_URL`.
 */
export function resolveDurableStorage(configuration: WeftConfiguration): Storage | null {
  if (configuration.databaseUrl) {
    const storage = new NeonStorage({ url: configuration.databaseUrl });
    assertDurableStorageForRecovery(storage);
    return storage;
  }
  if (configuration.isProduction) {
    throw new Error(
      'WEFT_DATABASE_URL is required in production: the engine needs durable storage to recover workflows.',
    );
  }
  return null;
}

// Module-level singletons: one engine + one client per process. Built lazily on
// first use and memoized as a promise so concurrent callers share one engine.
let enginePromise: Promise<Engine> | undefined;
let clientPromise: Promise<WeftClient | null> | undefined;

/**
 * Get the shared in-process engine, or `null` when no durable store is
 * configured. Throws (via {@link resolveDurableStorage}) in production with no
 * `WEFT_DATABASE_URL`.
 */
export function getEngine(): Promise<Engine | null> {
  if (!enginePromise) {
    const storage = resolveDurableStorage(getWeftConfiguration());
    if (!storage) {
      return Promise.resolve(null);
    }
    enginePromise = createEngine(storage);
  }
  return enginePromise;
}

/**
 * Get the shared Weft client (a {@link LocalClient} over the in-process engine),
 * or `null` when no durable store is configured. This is what the GitHub service
 * context carries as `weftClient`; producers dispatch through it
 * transport-agnostically and fall back to log-only when it is `null`.
 *
 * Dispatch is also safe before workflows are ported even when a client IS
 * present: the producers treat `WorkflowNotRegisteredError` as a no-op success,
 * so a live client over an empty registry never fails a webhook. Readiness is
 * gated on workflows being registered, not merely on storage being configured.
 */
export function getWeftClient(): Promise<WeftClient | null> {
  if (!clientPromise) {
    clientPromise = getEngine().then((engine) => (engine ? new LocalClient(engine) : null));
  }
  return clientPromise;
}
