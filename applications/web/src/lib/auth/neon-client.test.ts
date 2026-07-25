import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockPublicEnv = vi.hoisted(() => ({ PUBLIC_NEON_AUTH_URL: undefined as string | undefined }));

vi.mock('$env/dynamic/public', () => ({ env: mockPublicEnv }));

type CapturedOnSuccess = ((context: { data?: unknown }) => void) | undefined;
const capturedAdapterOptions = vi.hoisted(() => ({
  onSuccess: undefined as CapturedOnSuccess,
}));

vi.mock('@neondatabase/neon-js/auth/vanilla/adapters', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@neondatabase/neon-js/auth/vanilla/adapters')>();
  return {
    ...actual,
    BetterAuthVanillaAdapter: (options?: {
      fetchOptions?: { onSuccess?: (context: { data?: unknown }) => void };
    }) => {
      capturedAdapterOptions.onSuccess = options?.fetchOptions?.onSuccess;
      return actual.BetterAuthVanillaAdapter(options);
    },
  };
});

import {
  getNeonAuthClient,
  neonSessionRefreshIntervalMs,
  postNeonSessionToken,
  refreshNeonSessionCookie,
  startNeonSessionRefresh,
} from './neon-client';

describe('getNeonAuthClient', () => {
  beforeEach(() => {
    mockPublicEnv.PUBLIC_NEON_AUTH_URL = undefined;
    capturedAdapterOptions.onSuccess = undefined;
  });

  it('throws when PUBLIC_NEON_AUTH_URL is not configured', () => {
    expect(() => getNeonAuthClient()).toThrow('PUBLIC_NEON_AUTH_URL is required to use Neon Auth');
  });

  it('creates an auth client when PUBLIC_NEON_AUTH_URL is configured', () => {
    mockPublicEnv.PUBLIC_NEON_AUTH_URL = 'https://auth.example.com';

    const client = getNeonAuthClient();

    expect(client).toBeDefined();
  });

  it('wires an onSuccess hook that bridges a refreshed session token back to Tribunal', async () => {
    mockPublicEnv.PUBLIC_NEON_AUTH_URL = 'https://auth.example.com';
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    getNeonAuthClient();
    capturedAdapterOptions.onSuccess?.({ data: { session: { token: 'onsuccess-token' } } });

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/auth/neon-session',
        expect.objectContaining({ body: JSON.stringify({ token: 'onsuccess-token' }) }),
      );
    });

    vi.unstubAllGlobals();
  });
});

describe('postNeonSessionToken', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts the token to the session bridge endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await postNeonSessionToken('a-fresh-token');

    expect(fetchMock).toHaveBeenCalledWith('/api/auth/neon-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'a-fresh-token' }),
    });
  });

  it('throws with the response status and body when the bridge rejects the token', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response('unauthorized', { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(postNeonSessionToken('a-rejected-token')).rejects.toThrow(
      'Tribunal could not establish a Neon Auth session (status 401): unauthorized',
    );
  });
});

describe('refreshNeonSessionCookie', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts a newly seen session token extracted from session data', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    refreshNeonSessionCookie({ session: { token: 'refresh-token-1' } });

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/auth/neon-session',
        expect.objectContaining({ body: JSON.stringify({ token: 'refresh-token-1' }) }),
      );
    });
  });

  it('does not re-post the same token twice in a row', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    refreshNeonSessionCookie({ session: { token: 'refresh-token-2' } });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    refreshNeonSessionCookie({ session: { token: 'refresh-token-2' } });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('ignores session data without a usable token', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    refreshNeonSessionCookie(null);
    refreshNeonSessionCookie('not-an-object');
    refreshNeonSessionCookie({});
    refreshNeonSessionCookie({ session: null });
    refreshNeonSessionCookie({ session: {} });
    refreshNeonSessionCookie({ session: { token: '' } });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('logs but does not throw when the bridge POST fails', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response('server error', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => refreshNeonSessionCookie({ session: { token: 'refresh-token-3' } })).not.toThrow();

    await vi.waitFor(() => {
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Failed to refresh the Tribunal Neon Auth session cookie',
        expect.any(Error),
      );
    });

    consoleErrorSpy.mockRestore();
  });
});

describe('startNeonSessionRefresh', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('calls getSession immediately, then on the configured interval, until stopped', () => {
    const getSession = vi.fn().mockResolvedValue({ data: null, error: null });

    // A leading call matters: the bridged cookie's expiry mirrors the JWT's
    // own `exp`, set once at mint time -- not when this interval starts. A
    // page reload can mount this well into that window, so waiting a full
    // interval before the first refresh could let the cookie expire first.
    const stop = startNeonSessionRefresh({ getSession });
    expect(getSession).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(neonSessionRefreshIntervalMs);
    expect(getSession).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(neonSessionRefreshIntervalMs);
    expect(getSession).toHaveBeenCalledTimes(3);

    stop();
    vi.advanceTimersByTime(neonSessionRefreshIntervalMs * 2);
    expect(getSession).toHaveBeenCalledTimes(3);
  });
});
