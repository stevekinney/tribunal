import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';

vi.mock('@lostgradient/mcp/sveltekit', () => ({ primeSvelteKitMcpIdentity: vi.fn() }));
vi.mock('$lib/server/auth/dev-auth-bypass-flag', () => ({
  isDevAuthBypassEnabled: vi.fn(() => false),
}));

import { primeSvelteKitMcpIdentity } from '@lostgradient/mcp/sveltekit';
import { isDevAuthBypassEnabled } from '$lib/server/auth/dev-auth-bypass-flag';
import {
  cacheControlOn404Handle,
  createMcpIdentityHandle,
  createMcpMountHandle,
} from './mount-hooks';

function fakeEvent(pathname = '/mcp'): RequestEvent {
  const url = new URL(`http://localhost${pathname}`);
  return {
    request: new Request(url),
    url,
    locals: { user: null, requestId: 'req-test' },
    getClientAddress: () => '127.0.0.1',
  } as unknown as RequestEvent;
}

/** A synthetic authenticated user, as the auth handles populate on `locals`. */
function withUser(event: RequestEvent, id: number, username: string): RequestEvent {
  (event.locals as { user: unknown }).user = {
    id,
    username,
    name: username,
    avatarUrl: null,
    email: null,
    isPlatformAdministrator: false,
  };
  return event;
}

const respondWith = (status: number) => () => Promise.resolve(new Response('body', { status }));

describe('cacheControlOn404Handle', () => {
  it('adds Cache-Control: no-store to a 404 response', async () => {
    const response = await cacheControlOn404Handle({
      event: fakeEvent(),
      resolve: respondWith(404),
    } as never);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('leaves a non-404 response unchanged', async () => {
    const response = await cacheControlOn404Handle({
      event: fakeEvent(),
      resolve: respondWith(200),
    } as never);
    expect(response.headers.get('cache-control')).toBeNull();
  });
});

describe('MCP handles when the surface is disabled', () => {
  it('the mount handle falls through to resolve (ordinary 404)', async () => {
    const handle = createMcpMountHandle(() => null);
    const resolve = vi.fn(respondWith(404));
    const response = await handle({ event: fakeEvent('/oauth/authorize'), resolve } as never);
    expect(resolve).toHaveBeenCalledOnce();
    expect(response.status).toBe(404);
  });

  it('the identity handle does not prime and continues the chain', async () => {
    const handle = createMcpIdentityHandle(() => null);
    const resolve = vi.fn(respondWith(200));
    await handle({ event: fakeEvent(), resolve } as never);
    expect(resolve).toHaveBeenCalledOnce();
    expect(primeSvelteKitMcpIdentity).not.toHaveBeenCalled();
  });
});

describe('MCP identity priming and the dev auth bypass (TRI-45 AC2)', () => {
  // A truthy mount so the identity handle takes the priming branch.
  const activeMount = () => Promise.resolve({} as never);

  beforeEach(() => {
    vi.mocked(primeSvelteKitMcpIdentity).mockClear();
    vi.mocked(isDevAuthBypassEnabled).mockReturnValue(false);
  });

  it('primes the real user identity when the dev auth bypass is not armed', async () => {
    const handle = createMcpIdentityHandle(activeMount);
    const event = withUser(fakeEvent(), 7, 'real-user');
    await handle({ event, resolve: respondWith(200) } as never);
    expect(primeSvelteKitMcpIdentity).toHaveBeenCalledWith(
      event,
      expect.objectContaining({ subjectId: '7' }),
    );
  });

  it('primes null when the bypass is armed, so the synthetic user cannot own an OAuth grant', async () => {
    vi.mocked(isDevAuthBypassEnabled).mockReturnValue(true);
    const handle = createMcpIdentityHandle(activeMount);
    // Even though a (synthetic) user is on locals, the armed bypass must not
    // reach the mount as an identity.
    const event = withUser(fakeEvent(), 999, 'dev');
    await handle({ event, resolve: respondWith(200) } as never);
    expect(primeSvelteKitMcpIdentity).toHaveBeenCalledWith(event, null);
  });
});
