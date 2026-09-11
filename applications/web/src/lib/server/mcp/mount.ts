import { env } from '$env/dynamic/private';
import { createSvelteKitMcpMount, type SvelteKitMcpMount } from '@lostgradient/mcp/sveltekit';
import type { OAuthStores } from '@lostgradient/mcp/oauth/stores';
import { createOAuthStorageSeam, createOAuthStores } from '@tribunal/database/queries';
import { db } from '$lib/server/database';
import { tribunalMcpRegistry } from '$lib/server/mcp/registry';
import { createTribunalMcpRuntime } from '$lib/server/mcp/runtime';
import { tribunalOAuthDiscoveryConfiguration } from '$lib/server/oauth/configuration';
import { createTribunalOAuthSeams } from '$lib/server/oauth/seams';
import {
  resolveInstanceId,
  resolveSweepIntervalMs,
  startOauthCleanupSweep,
} from '$lib/server/oauth/cleanup-scheduler';
import { mcpLogger } from '$lib/server/mcp-logger';

/**
 * The name of the handle that primes identity for the mount. The library's
 * mount throws — naming this handle — when a request reaches it without an
 * earlier handle having called `primeSvelteKitMcpIdentity`.
 */
export const MCP_IDENTITY_HANDLE_NAME = 'mcpIdentityHandle';

/** The mount plus the host-side resource-update publisher the runtime exposes. */
export type AssembledMcpMount = {
  mount: SvelteKitMcpMount;
  /** Publishes `notifications/resources/updated` to a user's live subscription (TRI-126). */
  publishUserResourceUpdate: (userId: string, uri: string) => void;
};

export type TribunalMcpMount = AssembledMcpMount & {
  /**
   * On the shutdown signal, immediately (not deferred by the transport grace
   * window): stop the periodic cleanup sweep. If the HTTP drain — and therefore
   * `disposePool` — completes inside the grace window (no long-lived streams to
   * hold it open), a still-pending sweep tick would otherwise fire `purgeExpired`
   * after the pool was ended (TRI-51). Stopping the sweep first closes that race.
   */
  stopCleanupSweep: () => void;
  /**
   * Pre-drain (on the shutdown signal, after the grace window): gracefully close
   * the MCP transport. This ends the long-lived `subscriptions/listen`
   * streams through the library's sanctioned path (`mount.dispose` →
   * `runtime.shutdown` → `cache.closeAll`), not a forced connection close, so no
   * in-flight resource notifications are lost (the `stream-lifecycle.ts`
   * contract) — and it unblocks adapter-node's HTTP drain, which would otherwise
   * wait on those never-ending streams until `SHUTDOWN_TIMEOUT` force-closes
   * them (TRI-51 AC3).
   */
  shutdownTransport: () => Promise<void>;
  /**
   * Post-drain (on `sveltekit:shutdown`): close the OAuth connection pool, after
   * adapter-node has let ordinary in-flight OAuth requests — the only requests
   * that use this pool — finish. Closing it on the signal instead would pull the
   * pool out from under a `/token` or `/authorize` request still draining.
   */
  disposePool: () => Promise<void>;
};

/**
 * Constructs the single MCP + OAuth mount for this process.
 *
 * Exactly one mount may exist per process (the library enforces this and throws
 * on a second construction); `hooks.server.ts` calls this once at module scope
 * when the surface is enabled. Construction is async because the mount starts
 * the MCP runtime; a start failure disposes the storage pool before rethrowing.
 * The storage seam is built once and shared between the OAuth endpoints and the
 * MCP authenticator so they operate on the same tokens and connection.
 */
/**
 * Assembles the SvelteKit mount against a caller-supplied storage instance.
 * Shared by the production factory (which owns a connection pool) and the test
 * fixture (which injects PGlite-backed stores), so both exercise the same
 * runtime, seams, and mount configuration.
 */
export async function assembleTribunalMcpMount(stores: OAuthStores): Promise<AssembledMcpMount> {
  const runtime = createTribunalMcpRuntime(stores);
  const oauthSeams = createTribunalOAuthSeams(stores);
  const mount = await createSvelteKitMcpMount({
    oauthSeams,
    discoveryConfiguration: tribunalOAuthDiscoveryConfiguration,
    registry: tribunalMcpRegistry,
    identityHandleName: MCP_IDENTITY_HANDLE_NAME,
    longLivedProcess: true,
    getRequestId: (event) => (event.locals.requestId as string | undefined) ?? crypto.randomUUID(),
    mcp: runtime,
  });
  return { mount, publishUserResourceUpdate: runtime.publishUserResourceUpdate };
}

export async function createTribunalMcpMount(): Promise<TribunalMcpMount> {
  // Under E2E, back the OAuth stores with the request-scoped database proxy
  // (`$lib/server/database`'s `db`) instead of a dedicated Postgres pool: the
  // E2E handle routes that proxy to each Playwright worker's PGlite via
  // `runWithDatabase`, so the browser suite can drive the real mount and OAuth
  // flow without a Postgres instance. Production keeps its own pool below. This
  // branch is gated on E2E_TEST_MODE, which `assertE2EModeNotInProduction` makes
  // fatal in production, so it can never bind a request-scoped db in a real
  // deployment.
  if (env.E2E_TEST_MODE === '1') {
    const assembled = await assembleTribunalMcpMount(createOAuthStores(db));
    // E2E backs the stores with the request-scoped db proxy (no dedicated pool to
    // close) and runs no cleanup sweep, so only the transport needs shutting down.
    return {
      ...assembled,
      stopCleanupSweep: () => {},
      shutdownTransport: () => assembled.mount.dispose(),
      disposePool: async () => {},
    };
  }

  const connectionString = env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is required to mount the MCP and OAuth surface.');
  }

  const storage = createOAuthStorageSeam(connectionString);
  try {
    const assembled = await assembleTribunalMcpMount(storage.stores);

    // Own the periodic OAuth cleanup sweep here, on the production branch only
    // (TRI-51). It purges expired transactions, codes, and tokens through the
    // library primitives over this mount's dedicated pool — deliberately not on
    // the E2E branch, whose request-scoped database proxy only resolves inside
    // `runWithDatabase`, where a background timer has no context. The sweep
    // shares the mount's lifecycle: it is stopped in `dispose` before the pool
    // closes, so no tick can outlive the connection.
    const intervalMs = resolveSweepIntervalMs(Number(env.OAUTH_CLEANUP_INTERVAL_SECONDS));
    const cleanupSweep = startOauthCleanupSweep({ stores: storage.stores, intervalMs });
    mcpLogger.info(
      { instance: resolveInstanceId(process.env), intervalMs },
      'oauth cleanup sweep started',
    );

    return {
      ...assembled,
      stopCleanupSweep: () => cleanupSweep.stop(),
      shutdownTransport: () => assembled.mount.dispose(),
      disposePool: () => storage.dispose(),
    };
  } catch (error) {
    await storage.dispose();
    throw error;
  }
}
