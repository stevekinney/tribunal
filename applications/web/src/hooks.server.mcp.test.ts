import { afterAll, describe, expect, it, vi } from 'vitest';
import type { Handle, RequestEvent } from '@sveltejs/kit';

/**
 * Covers hooks.server.ts's enabled branch: constructing the single mount at
 * module scope, wiring the combined MCP handle after the identity handles, and
 * disposing on the post-drain `sveltekit:shutdown` event (TRI-51). The disabled
 * branch is covered by hooks.server.test.ts.
 */

const mockEnv: Record<string, string | undefined> = {
  MCP_ENABLED: 'true',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
  E2E_TEST_MODE: '0',
};
vi.mock('$env/dynamic/private', () => ({ env: mockEnv }));
vi.mock('$app/environment', () => ({ building: false, dev: false }));

let capturedHandles: Handle[] = [];
vi.mock('@sveltejs/kit/hooks', () => ({
  sequence: (...handles: Handle[]) => {
    capturedHandles = handles;
    return handles[0];
  },
}));

vi.mock('$lib/server/auth/neon-auth-configured', () => ({ assertNeonAuthConfigured: vi.fn() }));
vi.mock('$lib/server/github/webhooks/subscription-drift', () => ({
  warnOnGitHubAppConfigurationDriftAtStartup: vi.fn(() => Promise.resolve()),
}));

const mountDispose = vi.fn(() => Promise.resolve());
const mountShutdownTransport = vi.fn(() => Promise.resolve());
const mountDisposePool = vi.fn(() => Promise.resolve());
const mountHandle = vi.fn(() => Promise.resolve(new Response('ok', { status: 200 })));
const mountPublish = vi.fn();
const createTribunalMcpMount = vi.fn(() =>
  Promise.resolve({
    mount: { handle: mountHandle, dispose: mountDispose },
    publishUserResourceUpdate: mountPublish,
    shutdownTransport: mountShutdownTransport,
    disposePool: mountDisposePool,
  }),
);
vi.mock('$lib/server/mcp/mount', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/server/mcp/mount')>();
  return { ...actual, createTribunalMcpMount };
});

// Capture the process lifecycle handlers rather than emitting real signals or
// the `sveltekit:shutdown` event, either of which would disturb other test
// files sharing this worker's process.
const signalHandlers = new Map<string, () => void>();
vi.spyOn(process, 'once').mockImplementation((event, handler) => {
  signalHandlers.set(String(event), handler as () => void);
  return process;
});

const { authHandle } = await import('./hooks.server');
const { devAuthBypassHandle } = await import('$lib/server/auth/dev-bypass');

function fakeEvent(): RequestEvent {
  const url = new URL('http://localhost/');
  return {
    request: new Request(url),
    url,
    locals: { user: null, requestId: 'req-test' },
    getClientAddress: () => '127.0.0.1',
  } as unknown as RequestEvent;
}

const resolve = () => Promise.resolve(new Response('nf', { status: 404 }));

afterAll(() => {
  vi.restoreAllMocks();
});

describe('hooks.server MCP wiring (enabled)', () => {
  it('constructs the mount once and routes the final handle through the mount', async () => {
    expect(createTribunalMcpMount).toHaveBeenCalledOnce();

    const mcpHandle = capturedHandles[capturedHandles.length - 1]!;
    const response = await mcpHandle({ event: fakeEvent(), resolve } as never);

    expect(mountHandle).toHaveBeenCalled();
    expect(response.status).toBe(200);
  });

  it('sequences the MCP handle after every identity-populating handle (auth boundary)', () => {
    // authentication.md defines this ordering as a security boundary: the MCP
    // handle derives the OAuth identity from event.locals.user, which authHandle
    // populates and devAuthBypassHandle can override, so it must run after both.
    // Assert by index against the real handle references — a reorder that moved
    // the MCP handle before either identity handle would fail here, which the
    // previous "last two handles" assertion could not catch.
    const authIndex = capturedHandles.indexOf(authHandle);
    const bypassIndex = capturedHandles.indexOf(devAuthBypassHandle);
    const mcpIndex = capturedHandles.length - 1;

    expect(authIndex).toBeGreaterThanOrEqual(0);
    expect(bypassIndex).toBeGreaterThanOrEqual(0);
    expect(mcpIndex).toBeGreaterThan(authIndex);
    expect(mcpIndex).toBeGreaterThan(bypassIndex);
  });

  it('shuts down the MCP transport on SIGTERM (pre-drain) so listen streams close gracefully', async () => {
    // Phase 1 runs off the raw signal, before adapter-node's drain, so a
    // never-ending subscriptions/listen stream is closed through the library's
    // path rather than force-closed at SHUTDOWN_TIMEOUT (AC3 / Thread 3).
    signalHandlers.get('SIGTERM')!();
    await vi.waitFor(() => expect(mountShutdownTransport).toHaveBeenCalled());
  });

  it('disposes the OAuth pool on sveltekit:shutdown (post-drain, after in-flight requests finish)', async () => {
    // Phase 2 runs only after adapter-node drains, so an in-flight /token or
    // /authorize request keeps its pool connection to completion.
    signalHandlers.get('sveltekit:shutdown')!();
    await vi.waitFor(() => expect(mountDisposePool).toHaveBeenCalled());
  });

  it('logs rather than throwing when transport shutdown fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mountShutdownTransport.mockRejectedValueOnce(new Error('transport boom'));
    signalHandlers.get('SIGINT')!();
    await vi.waitFor(() =>
      expect(consoleError).toHaveBeenCalledWith(
        '[hooks.server] MCP transport shutdown failed',
        expect.any(Error),
      ),
    );
    consoleError.mockRestore();
  });

  it('logs rather than throwing when pool disposal fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mountDisposePool.mockRejectedValueOnce(new Error('pool boom'));
    signalHandlers.get('sveltekit:shutdown')!();
    await vi.waitFor(() =>
      expect(consoleError).toHaveBeenCalledWith(
        '[hooks.server] MCP pool dispose failed',
        expect.any(Error),
      ),
    );
    consoleError.mockRestore();
  });

  it('clears the resource-update publisher on transport shutdown so a torn-down mount is never invoked (TRI-126)', async () => {
    // Register a fresh spy so this is independent of the module-load
    // registration and of any earlier shutdown in this file.
    const {
      registerResourceUpdatePublisher,
      clearResourceUpdatePublisher,
      notifyReviewRunsChanged,
    } = await import('$lib/server/mcp/resource-updates');
    const publish = vi.fn();
    registerResourceUpdatePublisher(publish);
    notifyReviewRunsChanged(42);
    expect(publish).toHaveBeenCalledWith('42', 'tribunal://review-runs');

    // Transport shutdown (phase 1, on the signal) must clear the publisher so a
    // notification racing shutdown reaches nobody rather than a transport being
    // torn down.
    signalHandlers.get('SIGTERM')!();
    publish.mockClear();
    notifyReviewRunsChanged(42);
    expect(publish).not.toHaveBeenCalled();
    clearResourceUpdatePublisher();
  });

  it('logs and stays a no-op when the mount never constructs (TRI-126)', async () => {
    // A failed mount must not crash the web process, but it must be observable:
    // the notifier stays unregistered and the failure is logged rather than
    // silently swallowed. Re-import with a rejecting factory in isolation.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    createTribunalMcpMount.mockRejectedValueOnce(new Error('mount boom'));
    vi.resetModules();
    await import('./hooks.server');
    await vi.waitFor(() =>
      expect(consoleError).toHaveBeenCalledWith(
        '[hooks.server] MCP resource-update publisher registration failed',
        expect.any(Error),
      ),
    );
    consoleError.mockRestore();
  });
});
