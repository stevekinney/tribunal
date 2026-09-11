import type { RequestEvent } from '@sveltejs/kit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupMcpMountFixture, type McpMountFixture } from '$testing/mcp/mount-fixture';
import { createMcpHandle } from './mount-hooks';
import type { TribunalMcpMount } from './mount';

/**
 * Exercises Tribunal's real MCP handle against the real (PGlite-backed) mount,
 * confirming that a single handle primes identity and serves the mounted surface
 * in one step, and falls through for paths the mount does not own.
 *
 * This replaces an earlier two-handle "ordering" suite (AC3b). That design split
 * priming and serving across two handles and asserted the misordered composition
 * threw. It could not survive a real `sequence()`: SvelteKit's `merge_tracing`
 * gives each handler a distinct event object, so priming one and serving another
 * left the mount unprimed on every request. Combining them into one handle (which
 * primes and serves on the same event) is the fix; there is no ordering left to
 * get wrong. One fixture per file (Vitest module isolation).
 */

let fixture: McpMountFixture;

beforeAll(async () => {
  fixture = await setupMcpMountFixture();
});

afterAll(async () => {
  await fixture.dispose();
});

function requestEvent(request: Request): RequestEvent {
  return {
    request,
    url: new URL(request.url),
    locals: { user: null, requestId: 'req-test' },
    getClientAddress: () => '127.0.0.1',
  } as unknown as RequestEvent;
}

const notFound = () => Promise.resolve(new Response('Not Found', { status: 404 }));

/** Runs the handle for a request, returning the response the chain produces. */
function run(handle: ReturnType<typeof createMcpHandle>, request: Request): Promise<Response> {
  return Promise.resolve(
    handle({ event: requestEvent(request), resolve: notFound as never } as never),
  );
}

const discoveryRequest = () =>
  new Request('http://localhost:5173/.well-known/oauth-authorization-server');

describe('MCP mount handle', () => {
  const getMount = (): Promise<TribunalMcpMount> =>
    Promise.resolve({
      mount: fixture.mount,
      publishUserResourceUpdate: fixture.publishUserResourceUpdate,
      shutdownTransport: fixture.dispose,
      disposePool: async () => {},
    });
  const mcpHandle = createMcpHandle(getMount);

  it('primes identity and serves a mount-owned path in one handle', async () => {
    const response = await run(mcpHandle, discoveryRequest());
    expect(response.status).toBe(200);
  });

  it('falls through to resolve for a non-MCP path', async () => {
    // A path the mount does not own reaches resolve, which the handle wraps to
    // continue Tribunal's chain (here, an ordinary 404).
    const response = await run(mcpHandle, new Request('http://localhost:5173/'));
    expect(response.status).toBe(404);
  });
});
