import { afterAll, describe, expect, it, vi } from 'vitest';
import type { Handle, RequestEvent } from '@sveltejs/kit';

/**
 * Covers hooks.server.ts's enabled branch: constructing the single mount at
 * module scope, wiring the identity + mount handles, and disposing on SIGTERM.
 * The disabled branch is covered by hooks.server.test.ts.
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
const mountHandle = vi.fn(() => Promise.resolve(new Response('ok', { status: 200 })));
const createTribunalMcpMount = vi.fn(() =>
  Promise.resolve({ mount: { handle: mountHandle, dispose: mountDispose }, dispose: mountDispose }),
);
vi.mock('$lib/server/mcp/mount', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/server/mcp/mount')>();
  return { ...actual, createTribunalMcpMount };
});

await import('./hooks.server');

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
  process.removeAllListeners('SIGTERM');
  process.removeAllListeners('SIGINT');
});

describe('hooks.server MCP wiring (enabled)', () => {
  it('constructs the mount once and routes through the identity and mount handles', async () => {
    expect(createTribunalMcpMount).toHaveBeenCalledOnce();

    const mcpMountHandle = capturedHandles[capturedHandles.length - 1]!;
    const mcpIdentityHandle = capturedHandles[capturedHandles.length - 2]!;

    await mcpIdentityHandle({ event: fakeEvent(), resolve } as never);
    const response = await mcpMountHandle({ event: fakeEvent(), resolve } as never);

    expect(mountHandle).toHaveBeenCalled();
    expect(response.status).toBe(200);
  });

  it('disposes the mount on SIGTERM', async () => {
    process.emit('SIGTERM');
    await vi.waitFor(() => expect(mountDispose).toHaveBeenCalled());
  });

  it('logs rather than throwing when disposal fails on SIGINT', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mountDispose.mockRejectedValueOnce(new Error('dispose boom'));
    process.emit('SIGINT');
    await vi.waitFor(() =>
      expect(consoleError).toHaveBeenCalledWith(
        '[hooks.server] MCP mount dispose failed',
        expect.any(Error),
      ),
    );
    consoleError.mockRestore();
  });
});
