import { env } from '$env/dynamic/private';
import { createSvelteKitMcpMount, type SvelteKitMcpMount } from '@lostgradient/mcp/sveltekit';
import type { OAuthStores } from '@lostgradient/mcp/oauth/stores';
import { createOAuthStorageSeam, createOAuthStores } from '@tribunal/database/queries';
import { db } from '$lib/server/database';
import { tribunalMcpRegistry } from '$lib/server/mcp/registry';
import { createTribunalMcpRuntime } from '$lib/server/mcp/runtime';
import { tribunalOAuthDiscoveryConfiguration } from '$lib/server/oauth/configuration';
import { createTribunalOAuthSeams } from '$lib/server/oauth/seams';

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
  /** Disposes the mount and the storage connection pool it owns. */
  dispose: () => Promise<void>;
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
    return { ...assembled, dispose: () => assembled.mount.dispose() };
  }

  const connectionString = env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is required to mount the MCP and OAuth surface.');
  }

  const storage = createOAuthStorageSeam(connectionString);
  try {
    const assembled = await assembleTribunalMcpMount(storage.stores);
    return {
      ...assembled,
      dispose: async () => {
        await assembled.mount.dispose();
        await storage.dispose();
      },
    };
  } catch (error) {
    await storage.dispose();
    throw error;
  }
}
