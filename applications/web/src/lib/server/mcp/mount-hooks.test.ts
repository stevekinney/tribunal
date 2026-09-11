import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';

vi.mock('@lostgradient/mcp/sveltekit', () => ({ primeSvelteKitMcpIdentity: vi.fn() }));
vi.mock('$lib/server/auth/dev-auth-bypass-flag', () => ({
  isDevAuthBypassEnabled: vi.fn(() => false),
}));

import { primeSvelteKitMcpIdentity } from '@lostgradient/mcp/sveltekit';
import { isDevAuthBypassEnabled } from '$lib/server/auth/dev-auth-bypass-flag';
import { cacheControlOn404Handle, createMcpHandle } from './mount-hooks';

/** A mock mount whose handle continues the chain, so priming can be asserted. */
function passthroughMount() {
  return Promise.resolve({
    mount: {
      handle: ({
        event,
        resolve,
      }: {
        event: RequestEvent;
        resolve: (event: RequestEvent) => Promise<Response>;
      }) => resolve(event),
    },
    dispose: async () => {},
  } as never);
}

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

describe('createMcpHandle when the surface is disabled', () => {
  it('falls through to resolve without priming (ordinary 404)', async () => {
    const handle = createMcpHandle(() => null);
    const resolve = vi.fn(respondWith(404));
    const response = await handle({ event: fakeEvent('/oauth/authorize'), resolve } as never);
    expect(resolve).toHaveBeenCalledOnce();
    expect(response.status).toBe(404);
    expect(primeSvelteKitMcpIdentity).not.toHaveBeenCalled();
  });
});

describe('createMcpHandle skips operational paths (TRI-52)', () => {
  it.each(['/health', '/health/ready', '/metrics'])(
    'serves %s without ever consulting the mount, so a pending/failed mount cannot hang it',
    async (path) => {
      const getMount = vi.fn(() => {
        throw new Error('mount must not be consulted for operational paths');
      });
      const handle = createMcpHandle(getMount as never);
      const resolve = vi.fn(respondWith(200));

      const response = await handle({ event: fakeEvent(path), resolve } as never);

      expect(response.status).toBe(200);
      expect(resolve).toHaveBeenCalledOnce();
      expect(getMount).not.toHaveBeenCalled();
      expect(primeSvelteKitMcpIdentity).not.toHaveBeenCalled();
    },
  );
});

describe('createMcpHandle identity priming and the dev auth bypass (TRI-45 AC2)', () => {
  beforeEach(() => {
    vi.mocked(primeSvelteKitMcpIdentity).mockClear();
    vi.mocked(isDevAuthBypassEnabled).mockReturnValue(false);
  });

  it('primes the real user identity when the dev auth bypass is not armed', async () => {
    const handle = createMcpHandle(passthroughMount);
    const event = withUser(fakeEvent(), 7, 'real-user');
    await handle({ event, resolve: respondWith(200) } as never);
    expect(primeSvelteKitMcpIdentity).toHaveBeenCalledWith(
      event,
      expect.objectContaining({ subjectId: '7' }),
    );
  });

  it('primes null when the bypass is armed, so the synthetic user cannot own an OAuth grant', async () => {
    vi.mocked(isDevAuthBypassEnabled).mockReturnValue(true);
    const handle = createMcpHandle(passthroughMount);
    // Even though a (synthetic) user is on locals, the armed bypass must not
    // reach the mount as an identity.
    const event = withUser(fakeEvent(), 999, 'dev');
    await handle({ event, resolve: respondWith(200) } as never);
    expect(primeSvelteKitMcpIdentity).toHaveBeenCalledWith(event, null);
  });

  it('primes and serves on the SAME event object (guards the merge_tracing bug)', async () => {
    // Regression for the bug that combining the handles fixed: the library keys
    // priming on the event object, and SvelteKit's sequence() hands each handler
    // a distinct (merge_tracing-cloned) event. A separate identity handle primed
    // a different event than the mount later read, so the mount rejected every
    // request as unprimed. One handle priming and serving on one event is the fix
    // — assert the primed event is exactly the event handed to mount.handle.
    let servedEvent: unknown;
    const recordingMount = () =>
      Promise.resolve({
        mount: {
          handle: ({
            event,
            resolve,
          }: {
            event: RequestEvent;
            resolve: (event: RequestEvent) => Promise<Response>;
          }) => {
            servedEvent = event;
            return resolve(event);
          },
        },
        dispose: async () => {},
      } as never);
    const handle = createMcpHandle(recordingMount);
    const event = withUser(fakeEvent(), 7, 'real-user');
    await handle({ event, resolve: respondWith(200) } as never);
    const lastCall = vi.mocked(primeSvelteKitMcpIdentity).mock.calls.at(-1);
    expect(lastCall?.[0]).toBe(servedEvent);
  });
});
