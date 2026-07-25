import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockPublicEnv = vi.hoisted(() => ({ PUBLIC_NEON_AUTH_URL: undefined as string | undefined }));

vi.mock('$env/dynamic/public', () => ({ env: mockPublicEnv }));

import {
  broadcastNeonSessionLogout,
  getNeonAuthClient,
  neonSessionResumeRefreshPendingMaximumMs,
  neonSessionRefreshIntervalMs,
  postNeonSessionToken,
  refreshNeonSessionCookie,
  startNeonSessionRefresh,
} from './neon-client';

describe('getNeonAuthClient', () => {
  beforeEach(() => {
    mockPublicEnv.PUBLIC_NEON_AUTH_URL = undefined;
  });

  it('throws when PUBLIC_NEON_AUTH_URL is not configured', () => {
    expect(() => getNeonAuthClient()).toThrow('PUBLIC_NEON_AUTH_URL is required to use Neon Auth');
  });

  it('creates an auth client when PUBLIC_NEON_AUTH_URL is configured', () => {
    mockPublicEnv.PUBLIC_NEON_AUTH_URL = 'https://auth.example.com';

    const client = getNeonAuthClient();

    expect(client).toBeDefined();
  });
});

describe('postNeonSessionToken', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts the token to the session bridge endpoint with refreshOnly false by default', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await postNeonSessionToken('a-fresh-token');

    expect(fetchMock).toHaveBeenCalledWith('/api/auth/neon-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'a-fresh-token', refreshOnly: false }),
    });
  });

  it('posts refreshOnly true when requested', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await postNeonSessionToken('a-fresh-token', { refreshOnly: true });

    expect(fetchMock).toHaveBeenCalledWith('/api/auth/neon-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'a-fresh-token', refreshOnly: true }),
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

  it('posts a newly seen session token extracted from session data, refresh-only', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    refreshNeonSessionCookie({ session: { token: 'refresh-token-1' } });

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/auth/neon-session',
        expect.objectContaining({
          body: JSON.stringify({ token: 'refresh-token-1', refreshOnly: true }),
        }),
      );
    });
  });

  it('forwards a signal option through to the underlying fetch call', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();

    refreshNeonSessionCookie(
      { session: { token: 'refresh-token-signal' } },
      { signal: controller.signal },
    );

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/auth/neon-session',
        expect.objectContaining({ signal: controller.signal }),
      );
    });
  });

  it('does not log a failure caused by the caller having already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchMock = vi.fn().mockRejectedValueOnce(new DOMException('Aborted', 'AbortError'));
    vi.stubGlobal('fetch', fetchMock);
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    refreshNeonSessionCookie(
      { session: { token: 'refresh-token-aborted' } },
      { signal: controller.signal },
    );

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    // Give the rejected postNeonSessionToken promise a turn to settle before
    // asserting the negative -- there's nothing else to await here.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(consoleErrorSpy).not.toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
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

    // A leading call matters: the bridged cookie's expiry mirrors the most
    // recently *posted* token's own `exp`, reset fresh on every successful
    // refresh -- not fixed at sign-in. A page reload can mount this well
    // into the current window, so waiting a full interval before the first
    // refresh could let the cookie expire first.
    const stop = startNeonSessionRefresh({ getSession });
    expect(getSession).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(neonSessionRefreshIntervalMs);
    expect(getSession).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(neonSessionRefreshIntervalMs);
    // No activity-based idle cutoff: a visible tab keeps refreshing on
    // every interval indefinitely (see the "Gate polling on tab
    // visibility, not recent user activity" rule in
    // .claude/rules/authentication.md for why an idle cutoff was removed).
    expect(getSession).toHaveBeenCalledTimes(3);

    stop();
    vi.advanceTimersByTime(neonSessionRefreshIntervalMs * 3);
    expect(getSession).toHaveBeenCalledTimes(3);
  });

  it('passes an AbortSignal to every getSession call and aborts it when stopped', () => {
    const signals: Array<AbortSignal | undefined> = [];
    const getSession = vi
      .fn()
      .mockImplementation((options?: { fetchOptions?: { signal?: AbortSignal } }) => {
        signals.push(options?.fetchOptions?.signal);
        return Promise.resolve({ data: null, error: null });
      });

    const stop = startNeonSessionRefresh({ getSession });
    expect(signals).toHaveLength(1);
    expect(signals[0]?.aborted).toBe(false);

    stop();

    // Guards against a request already in flight when the caller tears down
    // (e.g. navigating from the authenticated shell to /logout) resolving
    // afterward and re-posting the token to the session bridge.
    expect(signals[0]?.aborted).toBe(true);
  });

  it('does not reject when getSession itself rejects (e.g. from an abort)', () => {
    const getSession = vi.fn().mockRejectedValue(new Error('AbortError'));

    expect(() => startNeonSessionRefresh({ getSession })).not.toThrow();
  });

  it('is idempotent when the returned stop function is called more than once', () => {
    const getSession = vi.fn().mockResolvedValue({ data: null, error: null });
    const stop = startNeonSessionRefresh({ getSession });

    stop();

    expect(() => stop()).not.toThrow();
  });

  describe('bridging a refreshed session to the session bridge endpoint', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('posts a refreshed token to the bridge endpoint, refresh-only, reusing the getSession AbortSignal', async () => {
      const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
      vi.stubGlobal('fetch', fetchMock);
      const getSession = vi.fn().mockResolvedValue({
        data: { session: { token: 'interval-token' } },
        error: null,
      });

      startNeonSessionRefresh({ getSession });
      await vi.advanceTimersByTimeAsync(0);

      expect(fetchMock).toHaveBeenCalledWith(
        '/api/auth/neon-session',
        expect.objectContaining({
          body: JSON.stringify({ token: 'interval-token', refreshOnly: true }),
        }),
      );

      // Not just "some" signal -- the *same* one getSession's own call got,
      // so aborting one aborts both.
      const [sessionOptions] = getSession.mock.calls[0] as [
        { fetchOptions?: { signal?: AbortSignal } },
      ];
      const [, requestInit] = fetchMock.mock.calls[0] as [string, { signal?: AbortSignal }];
      expect(requestInit.signal).toBeInstanceOf(AbortSignal);
      expect(requestInit.signal).toBe(sessionOptions.fetchOptions?.signal);
    });

    it('aborts an in-flight bridge POST when stopped, so it cannot recreate the cookie after logout', async () => {
      let capturedSignal: AbortSignal | undefined;
      const fetchMock = vi
        .fn()
        .mockImplementation((_url: string, init: { signal?: AbortSignal }) => {
          capturedSignal = init.signal;
          return new Promise(() => {
            // Never resolves -- simulates a bridge POST still in flight when
            // the caller tears down (e.g. a logout navigation).
          });
        });
      vi.stubGlobal('fetch', fetchMock);
      const getSession = vi.fn().mockResolvedValue({
        data: { session: { token: 'in-flight-token' } },
        error: null,
      });

      const stop = startNeonSessionRefresh({ getSession });
      await vi.advanceTimersByTimeAsync(0);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(capturedSignal?.aborted).toBe(false);

      stop();

      expect(capturedSignal?.aborted).toBe(true);
    });

    it('does not post to the bridge endpoint when getSession returns no session data', async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      const getSession = vi.fn().mockResolvedValue({ data: null, error: null });

      startNeonSessionRefresh({ getSession });
      await vi.advanceTimersByTimeAsync(0);

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('tolerates a non-object getSession result without throwing', async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      const getSession = vi.fn().mockResolvedValue(null);

      expect(() => startNeonSessionRefresh({ getSession })).not.toThrow();
      await vi.advanceTimersByTimeAsync(0);

      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('visibility gating', () => {
    let visibilityState: 'visible' | 'hidden';
    let listeners: Map<string, Set<() => void>>;

    function fireVisibilityChange(): void {
      for (const listener of listeners.get('visibilitychange') ?? []) listener();
    }

    beforeEach(() => {
      visibilityState = 'visible';
      listeners = new Map();
      vi.stubGlobal('document', {
        get visibilityState() {
          return visibilityState;
        },
        addEventListener: (event: string, listener: () => void) => {
          const existing = listeners.get(event) ?? new Set();
          existing.add(listener);
          listeners.set(event, existing);
        },
        removeEventListener: (event: string, listener: () => void) => {
          listeners.get(event)?.delete(listener);
        },
      });
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('marks a visible-tab resume refresh as pending until the bridge post settles', async () => {
      const pendingChanges: boolean[] = [];
      let resolveBridgePost: ((response: Response) => void) | undefined;
      const fetchMock = vi.fn().mockImplementation(
        () =>
          new Promise<Response>((resolve) => {
            resolveBridgePost = resolve;
          }),
      );
      vi.stubGlobal('fetch', fetchMock);
      const getSession = vi
        .fn()
        .mockResolvedValueOnce({ data: null, error: null })
        .mockResolvedValueOnce({
          data: { session: { token: 'resume-token-pending' } },
          error: null,
        });

      startNeonSessionRefresh(
        { getSession },
        { onResumeRefreshPendingChange: (pending) => pendingChanges.push(pending) },
      );

      visibilityState = 'visible';
      fireVisibilityChange();
      await vi.advanceTimersByTimeAsync(0);

      expect(pendingChanges).toEqual([true]);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      resolveBridgePost?.(new Response('{}', { status: 200 }));
      await vi.advanceTimersByTimeAsync(0);

      expect(pendingChanges).toEqual([true, false]);
    });

    it('clears a visible-tab resume pending state after the capped wait when the network hangs', async () => {
      const pendingChanges: boolean[] = [];
      const getSession = vi
        .fn()
        .mockResolvedValueOnce({ data: null, error: null })
        .mockImplementationOnce(
          () =>
            new Promise(() => {
              // Never resolves: offline or captive-portal refresh.
            }),
        );

      startNeonSessionRefresh(
        { getSession },
        {
          onResumeRefreshPendingChange: (pending) => pendingChanges.push(pending),
          resumeRefreshPendingMaximumMs: 25,
        },
      );

      visibilityState = 'visible';
      fireVisibilityChange();

      expect(pendingChanges).toEqual([true]);

      vi.advanceTimersByTime(24);
      expect(pendingChanges).toEqual([true]);

      vi.advanceTimersByTime(1);
      expect(pendingChanges).toEqual([true, false]);
    });

    it('does not let an older resume refresh clear a newer pending gate', async () => {
      const pendingChanges: boolean[] = [];
      const bridgePostResolutions: Array<(response: Response) => void> = [];
      const fetchMock = vi.fn().mockImplementation(
        () =>
          new Promise<Response>((resolve) => {
            bridgePostResolutions.push(resolve);
          }),
      );
      vi.stubGlobal('fetch', fetchMock);
      const getSession = vi
        .fn()
        .mockResolvedValueOnce({ data: null, error: null })
        .mockResolvedValueOnce({
          data: { session: { token: 'resume-token-old' } },
          error: null,
        })
        .mockResolvedValueOnce({
          data: { session: { token: 'resume-token-new' } },
          error: null,
        });

      startNeonSessionRefresh(
        { getSession },
        { onResumeRefreshPendingChange: (pending) => pendingChanges.push(pending) },
      );

      visibilityState = 'visible';
      fireVisibilityChange();
      await vi.advanceTimersByTimeAsync(0);

      fireVisibilityChange();
      await vi.advanceTimersByTimeAsync(0);

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(pendingChanges).toEqual([true]);

      bridgePostResolutions[0]?.(new Response('{}', { status: 200 }));
      await vi.advanceTimersByTimeAsync(0);
      expect(pendingChanges).toEqual([true]);

      bridgePostResolutions[1]?.(new Response('{}', { status: 200 }));
      await vi.advanceTimersByTimeAsync(0);
      expect(pendingChanges).toEqual([true, false]);
    });

    it('does not mark routine interval refreshes as pending', () => {
      const pendingChanges: boolean[] = [];
      const getSession = vi.fn().mockResolvedValue({ data: null, error: null });

      startNeonSessionRefresh(
        { getSession },
        { onResumeRefreshPendingChange: (pending) => pendingChanges.push(pending) },
      );

      vi.advanceTimersByTime(neonSessionRefreshIntervalMs * 2);

      expect(getSession).toHaveBeenCalledTimes(3);
      expect(pendingChanges).toEqual([]);
    });

    it('skips the scheduled interval refresh while the tab is hidden', () => {
      const getSession = vi.fn().mockResolvedValue({ data: null, error: null });
      startNeonSessionRefresh({ getSession });
      expect(getSession).toHaveBeenCalledTimes(1); // leading call is unconditional

      visibilityState = 'hidden';
      vi.advanceTimersByTime(neonSessionRefreshIntervalMs);
      expect(getSession).toHaveBeenCalledTimes(1);

      visibilityState = 'visible';
      vi.advanceTimersByTime(neonSessionRefreshIntervalMs);
      expect(getSession).toHaveBeenCalledTimes(2);
    });

    it('refreshes once immediately when the tab becomes visible again', () => {
      const getSession = vi.fn().mockResolvedValue({ data: null, error: null });
      startNeonSessionRefresh({ getSession });
      expect(getSession).toHaveBeenCalledTimes(1);

      visibilityState = 'hidden';
      fireVisibilityChange();
      expect(getSession).toHaveBeenCalledTimes(1);

      visibilityState = 'visible';
      fireVisibilityChange();
      expect(getSession).toHaveBeenCalledTimes(2);
    });

    it('stops listening for visibility changes once stopped', () => {
      const getSession = vi.fn().mockResolvedValue({ data: null, error: null });
      const stop = startNeonSessionRefresh({ getSession });
      stop();

      visibilityState = 'visible';
      fireVisibilityChange();

      expect(getSession).toHaveBeenCalledTimes(1); // only the leading call
    });

    it('keeps refreshing on every interval regardless of user activity while visible', () => {
      // No activity-based idle cutoff (removed -- see the "Gate polling on
      // tab visibility, not recent user activity" rule in
      // .claude/rules/authentication.md): a visible tab refreshes on every
      // scheduled tick indefinitely, with zero simulated user activity.
      const getSession = vi.fn().mockResolvedValue({ data: null, error: null });
      startNeonSessionRefresh({ getSession });
      expect(getSession).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(neonSessionRefreshIntervalMs * 4);
      expect(getSession).toHaveBeenCalledTimes(5);
    });

    it('uses the default capped wait for visible-tab resume pending state', () => {
      const pendingChanges: boolean[] = [];
      const getSession = vi
        .fn()
        .mockResolvedValueOnce({ data: null, error: null })
        .mockImplementationOnce(
          () =>
            new Promise(() => {
              // Never resolves: the cap clears the UI gate independently.
            }),
        );

      startNeonSessionRefresh(
        { getSession },
        { onResumeRefreshPendingChange: (pending) => pendingChanges.push(pending) },
      );

      visibilityState = 'visible';
      fireVisibilityChange();

      vi.advanceTimersByTime(neonSessionResumeRefreshPendingMaximumMs);

      expect(pendingChanges).toEqual([true, false]);
    });
  });
});

describe('broadcastNeonSessionLogout / cross-tab logout coordination', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is a no-op when BroadcastChannel is unavailable', () => {
    vi.stubGlobal('BroadcastChannel', undefined);

    expect(() => broadcastNeonSessionLogout()).not.toThrow();
  });

  it('still starts and stops locally when BroadcastChannel is unavailable', () => {
    vi.stubGlobal('BroadcastChannel', undefined);

    const getSession = vi.fn().mockResolvedValue({ data: null, error: null });
    const stop = startNeonSessionRefresh({ getSession });

    expect(getSession).toHaveBeenCalledTimes(1);
    expect(() => stop()).not.toThrow();
  });

  it('aborts an active refresh in another tab when logout is broadcast', async () => {
    let capturedSignal: AbortSignal | undefined;
    const getSession = vi
      .fn()
      .mockImplementation((options?: { fetchOptions?: { signal?: AbortSignal } }) => {
        capturedSignal = options?.fetchOptions?.signal;
        return Promise.resolve({ data: null, error: null });
      });

    startNeonSessionRefresh({ getSession });
    expect(capturedSignal?.aborted).toBe(false);

    broadcastNeonSessionLogout();

    // BroadcastChannel delivery is a genuine asynchronous (macrotask-driven)
    // hop, not a plain microtask -- give it a real tick. Never calling the
    // returned `stop()` here is the point: an aborted signal is only
    // possible if the broadcast's own listener tore this down internally.
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(capturedSignal?.aborted).toBe(true);
  });

  it('does not error when logout is broadcast after the caller already stopped it', async () => {
    const getSession = vi.fn().mockResolvedValue({ data: null, error: null });
    const stop = startNeonSessionRefresh({ getSession });
    stop();

    expect(() => broadcastNeonSessionLogout()).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
});
