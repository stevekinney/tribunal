import type { Handle, RequestEvent } from '@sveltejs/kit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupMcpMountFixture, type McpMountFixture } from '$testing/mcp/mount-fixture';
import { createMcpIdentityHandle, createMcpMountHandle } from './mount-hooks';
import type { TribunalMcpMount } from './mount';

/**
 * Composes Tribunal's own handles both correctly and misordered and watches the
 * misorder throw (AC3b). The composition is manual rather than via SvelteKit's
 * `sequence()`, which requires the request-store AsyncLocalStorage that only
 * exists during a real request; chaining each handle's `resolve` to the next
 * reproduces the identical ordering semantics. One fixture per file (Vitest
 * module isolation).
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

/** Chains two handles so `first`'s resolve runs `second`, then a final 404. */
function chain(first: Handle, second: Handle, request: Request): Promise<Response> {
  const event = requestEvent(request);
  return Promise.resolve(
    first({
      event,
      resolve: ((nextEvent: RequestEvent) =>
        second({ event: nextEvent, resolve: notFound as never })) as never,
    } as never),
  );
}

const discoveryRequest = () =>
  new Request('http://localhost:5173/.well-known/oauth-authorization-server');

describe('MCP mount hook ordering', () => {
  const getMount = (): Promise<TribunalMcpMount> =>
    Promise.resolve({ mount: fixture.mount, dispose: fixture.dispose });
  const identityHandle = createMcpIdentityHandle(getMount);
  const mountHandle = createMcpMountHandle(getMount);

  it('throws when the mount handle runs before identity is primed', async () => {
    // Misordered: the mount handle runs first, before the identity handle.
    await expect(chain(mountHandle, identityHandle, discoveryRequest())).rejects.toThrow(
      'prime identity',
    );
  });

  it('serves once identity is primed earlier in the chain', async () => {
    const response = await chain(identityHandle, mountHandle, discoveryRequest());
    expect(response.status).toBe(200);
  });

  it('falls through to resolve for a non-MCP path', async () => {
    // A path the mount does not own reaches resolve, which the mount handle
    // wraps to continue Tribunal's chain.
    const response = await chain(
      identityHandle,
      mountHandle,
      new Request('http://localhost:5173/'),
    );
    expect(response.status).toBe(404);
  });
});
