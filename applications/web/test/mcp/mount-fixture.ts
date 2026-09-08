import type { RequestEvent } from '@sveltejs/kit';
import { createOAuthStores } from '@tribunal/database/queries';
import { createTestDatabase, type TestDatabase } from '@tribunal/test/database';
import type { OAuthStores } from '@lostgradient/mcp/oauth/stores';
import {
  type SvelteKitLikeRequestEvent,
  type SvelteKitMcpMount,
} from '@lostgradient/mcp/sveltekit';
import { assembleTribunalMcpMount, type TribunalMcpMount } from '$lib/server/mcp/mount';
import { createMcpIdentityHandle, createMcpMountHandle } from '$lib/server/mcp/mount-hooks';
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
  const mount = await assembleTribunalMcpMount(stores);

  // Route requests through the same handles production composes in
  // hooks.server.ts, so tests see the real behaviour — identity priming, the
  // security-header decorator, and the mount's own routing — not a partial
  // stand-in that skips them.
  const mountRecord: TribunalMcpMount = { mount, dispose: () => mount.dispose() };
  const getMount = (): Promise<TribunalMcpMount> => Promise.resolve(mountRecord);
  const identityHandle = createMcpIdentityHandle(getMount);
  const mountHandle = createMcpMountHandle(getMount);

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
    buildEvent,
    handle: (request, options = {}) => {
      const event = buildEvent(request, options) as unknown as RequestEvent;
      return Promise.resolve(
        identityHandle({
          event,
          resolve: ((nextEvent: RequestEvent) =>
            mountHandle({ event: nextEvent, resolve: notFoundResolve as never })) as never,
        } as never),
      ) as Promise<Response>;
    },
    dispose: async () => {
      await mount.dispose();
      await database.close();
    },
  };
}
