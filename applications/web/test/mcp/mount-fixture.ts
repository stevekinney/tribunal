import type { RequestEvent } from '@sveltejs/kit';
import { createOAuthStores } from '@tribunal/database/queries';
import { createTestDatabase, type TestDatabase } from '@tribunal/test/database';
import type { OAuthStores } from '@lostgradient/mcp/oauth/stores';
import {
  type SvelteKitLikeRequestEvent,
  type SvelteKitMcpMount,
} from '@lostgradient/mcp/sveltekit';
import { assembleTribunalMcpMount, type TribunalMcpMount } from '$lib/server/mcp/mount';
import { createMcpHandle } from '$lib/server/mcp/mount-hooks';
import type { AuthenticatedApplicationUser } from '$lib/server/auth/neon-session';

/**
 * Shared test support that stands up Tribunal's real MCP + OAuth mount against
 * a PGlite database, so the mount, ordering, and SSRF verification suites
 * (TRI-41, TRI-37, TRI-42) exercise one bootstrap instead of three. The mount
 * enforces one live instance per process; Vitest's `isolate: true` gives each
 * test file fresh module state, so a file may stand up exactly one fixture.
 */

export type MountRequestOptions = {
  /** The authenticated user to prime identity from (null for anonymous). */
  user?: AuthenticatedApplicationUser | null;
  /** The client address the mount should see for this request. */
  clientAddress?: string;
};

export type McpMountFixture = {
  mount: SvelteKitMcpMount;
  database: TestDatabase;
  /** The OAuth stores the mount uses, for seeding clients/tokens in tests. */
  stores: OAuthStores;
  /** Publishes a resource update to a user's live subscription (TRI-126), as the review layer's producer does. */
  publishUserResourceUpdate(userId: string, uri: string): void;
  /** Builds a mount event from a request without priming identity. */
  buildEvent(request: Request, options?: MountRequestOptions): SvelteKitLikeRequestEvent;
  /** Primes identity from the options and routes the request through the mount. */
  handle(request: Request, options?: MountRequestOptions): Promise<Response>;
  dispose(): Promise<void>;
};

/** A `resolve` that returns SvelteKit's ordinary 404 for paths the mount passes through. */
function notFoundResolve(): Promise<Response> {
  return Promise.resolve(new Response('Not Found', { status: 404 }));
}

export async function setupMcpMountFixture(): Promise<McpMountFixture> {
  const database = await createTestDatabase();
  const stores = createOAuthStores(database.db);
  const { mount, publishUserResourceUpdate } = await assembleTribunalMcpMount(stores);

  // Route requests through the MCP handle hooks.server.ts composes — priming,
  // routing, and the security-header decorator in one — so tests see real
  // behavior rather than a partial stand-in. It does not run the outer chain
  // (correlation, auth, dev bypass); the `user` option stands in for what those
  // handles would populate.
  const mountRecord: TribunalMcpMount = {
    mount,
    publishUserResourceUpdate,
    stopCleanupSweep: () => {},
    shutdownTransport: () => mount.dispose(),
    disposePool: async () => {},
  };
  const getMount = (): Promise<TribunalMcpMount> => Promise.resolve(mountRecord);
  const mcpHandle = createMcpHandle(getMount);

  const buildEvent = (
    request: Request,
    options: MountRequestOptions = {},
  ): SvelteKitLikeRequestEvent => ({
    request,
    url: new URL(request.url),
    locals: { requestId: 'test-request', user: options.user ?? null },
    getClientAddress: () => options.clientAddress ?? '127.0.0.1',
  });

  return {
    mount,
    database,
    stores,
    publishUserResourceUpdate,
    buildEvent,
    handle: (request, options = {}) => {
      // The one unavoidable cast: buildEvent returns the library's structural
      // subset of a SvelteKit RequestEvent (see asMountEvent in mount-hooks).
      const event = buildEvent(request, options) as unknown as RequestEvent;
      return Promise.resolve(mcpHandle({ event, resolve: notFoundResolve }));
    },
    dispose: async () => {
      await mount.dispose();
      await database.close();
    },
  };
}
