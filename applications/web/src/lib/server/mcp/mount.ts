import { env } from '$env/dynamic/private';
import { createSvelteKitMcpMount, type SvelteKitMcpMount } from '@lostgradient/mcp/sveltekit';
import { createOAuthStorageSeam } from '@tribunal/database/queries';
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

export type TribunalMcpMount = {
  mount: SvelteKitMcpMount;
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
export async function createTribunalMcpMount(): Promise<TribunalMcpMount> {
  const connectionString = env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is required to mount the MCP and OAuth surface.');
  }

  const storage = createOAuthStorageSeam(connectionString);
  try {
    const runtime = createTribunalMcpRuntime(storage.stores);
    const oauthSeams = createTribunalOAuthSeams(storage.stores);
    const mount = await createSvelteKitMcpMount({
      oauthSeams,
      discoveryConfiguration: tribunalOAuthDiscoveryConfiguration,
      registry: tribunalMcpRegistry,
      identityHandleName: MCP_IDENTITY_HANDLE_NAME,
      longLivedProcess: true,
      getRequestId: (event) =>
        (event.locals.requestId as string | undefined) ?? crypto.randomUUID(),
      mcp: runtime,
    });

    return {
      mount,
      dispose: async () => {
        await mount.dispose();
        await storage.dispose();
      },
    };
  } catch (error) {
    await storage.dispose();
    throw error;
  }
}
