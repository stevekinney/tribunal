import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockRequestEvent } from '$lib/test-utils/request-event';
import { TransientAuthInfrastructureError } from '$lib/server/auth/neon-session';

const mockValidateNeonSessionFromToken = vi.hoisted(() => vi.fn());
const mockDeleteNeonAuthTokenCookie = vi.hoisted(() => vi.fn());
const mockWarnOnGitHubAppConfigurationDriftAtStartup = vi.hoisted(() => vi.fn());
const mockEnv = vi.hoisted(() => ({ E2E_TEST_MODE: '0' }));
const mockApplicationEnvironment = vi.hoisted(() => ({ building: false, dev: true }));
const mockAssertNeonAuthConfigured = vi.hoisted(() => vi.fn());

vi.mock('$env/dynamic/private', () => ({ env: mockEnv }));
vi.mock('$app/environment', () => ({
  get building() {
    return mockApplicationEnvironment.building;
  },
  get dev() {
    return mockApplicationEnvironment.dev;
  },
}));

vi.mock(import('$lib/server/auth/neon-auth-configured'), () => ({
  assertNeonAuthConfigured: mockAssertNeonAuthConfigured,
}));

vi.mock(import('$lib/server/github/webhooks/subscription-drift'), () => ({
  warnOnGitHubAppConfigurationDriftAtStartup: mockWarnOnGitHubAppConfigurationDriftAtStartup,
}));

// `sequence()` requires SvelteKit's real AsyncLocalStorage-backed request
// store, which is only available inside an actual request lifecycle — not in
// a unit test. `correlationHandle` is not exported (it's an internal building
// block of the composed `handle`), so the only way to unit-test it in
// isolation is to intercept the array `sequence()` is called with and invoke
// the first handle (correlationHandle) directly, bypassing SvelteKit's
// composition machinery entirely.
vi.mock('@sveltejs/kit/hooks', () => ({
  sequence:
    (...handles: Array<(input: unknown) => unknown>) =>
    (input: unknown) =>
      handles[0](input),
}));

vi.mock(import('$testing/end-to-end/handle'), () => ({
  e2eHandle: async ({
    event,
    resolve,
  }: {
    event: unknown;
    resolve: (event: never) => Response | Promise<Response>;
  }) => resolve(event as never),
}));

vi.mock(import('$lib/server/auth/dev-bypass'), () => ({
  devAuthBypassHandle: async ({
    event,
    resolve,
  }: {
    event: unknown;
    resolve: (event: never) => Response | Promise<Response>;
  }) => resolve(event as never),
}));

// Preserves the real module's exports (notably TransientAuthInfrastructureError)
// via importOriginal, only stubbing the two functions these tests drive —
// so `instanceof TransientAuthInfrastructureError` in hooks.server.ts compares
// against the real class rather than one the mock never provides.
vi.mock(import('$lib/server/auth/neon-session'), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    neonAuthTokenCookieName: 'tribunal-neon-auth-token' as const,
    validateNeonSessionFromToken: mockValidateNeonSessionFromToken,
    deleteNeonAuthTokenCookie: mockDeleteNeonAuthTokenCookie,
  };
});

describe('hooks auth handle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnv.E2E_TEST_MODE = '0';
    mockApplicationEnvironment.building = false;
    mockApplicationEnvironment.dev = true;
    mockAssertNeonAuthConfigured.mockReset();
    mockWarnOnGitHubAppConfigurationDriftAtStartup.mockReset();
    mockWarnOnGitHubAppConfigurationDriftAtStartup.mockResolvedValue(undefined);
  });

  it('populates locals.user from the Neon Auth bridge cookie', async () => {
    const user = {
      id: 1,
      username: 'test-user',
      name: 'Test User',
      avatarUrl: null,
      email: 'test@example.com',
      isPlatformAdministrator: false,
    };
    const neonSession = {
      neonAuthUserId: 'neon-user-1',
      expiresAt: new Date(Date.now() + 60_000),
    };
    mockValidateNeonSessionFromToken.mockResolvedValueOnce({ user, neonSession });

    const event = createMockRequestEvent();
    event.cookies.get = vi.fn((name) =>
      name === 'tribunal-neon-auth-token' ? 'valid-token' : undefined,
    );

    const { authHandle } = await import('./hooks.server');
    const response = await authHandle({
      event,
      resolve: () => new Response('ok'),
    });

    expect(response.status).toBe(200);
    expect(event.locals.user).toEqual(user);
    expect(event.locals.neonSession).toEqual(neonSession);
    expect(mockValidateNeonSessionFromToken).toHaveBeenCalledWith('valid-token');
    expect.assertions(4);
  });

  it('clears invalid Neon Auth bridge cookies', async () => {
    mockValidateNeonSessionFromToken.mockRejectedValueOnce(new Error('invalid token'));

    const event = createMockRequestEvent();
    event.cookies.get = vi.fn((name) =>
      name === 'tribunal-neon-auth-token' ? 'invalid-token' : undefined,
    );

    const { authHandle } = await import('./hooks.server');
    await authHandle({
      event,
      resolve: () => new Response('ok'),
    });

    expect(event.locals.user).toBeNull();
    expect(event.locals.neonSession).toBeNull();
    expect(mockDeleteNeonAuthTokenCookie).toHaveBeenCalledWith(event);
    expect.assertions(3);
  });

  it('leaves the Neon Auth bridge cookie intact when validation fails transiently', async () => {
    mockValidateNeonSessionFromToken.mockRejectedValueOnce(
      new TransientAuthInfrastructureError('Neon Auth JWKS verification unavailable', {
        cause: new Error('JWKS fetch timed out'),
      }),
    );

    const event = createMockRequestEvent();
    event.cookies.get = vi.fn((name) =>
      name === 'tribunal-neon-auth-token' ? 'some-token' : undefined,
    );

    const { authHandle } = await import('./hooks.server');
    const response = await authHandle({
      event,
      resolve: () => new Response('ok'),
    });

    expect(response.status).toBe(200);
    expect(event.locals.user).toBeNull();
    expect(event.locals.neonSession).toBeNull();
    // The load-bearing assertion: a transient infrastructure failure must
    // never clear the session cookie, or a JWKS/database hiccup logs the
    // user out exactly like an actually-expired token would.
    expect(mockDeleteNeonAuthTokenCookie).not.toHaveBeenCalled();
    expect.assertions(4);
  });

  it('sets locals to null without validating when no bridge cookie is present', async () => {
    const event = createMockRequestEvent();
    event.cookies.get = vi.fn(() => undefined);

    const { authHandle } = await import('./hooks.server');
    await authHandle({ event, resolve: () => new Response('ok') });

    expect(event.locals.user).toBeNull();
    expect(event.locals.neonSession).toBeNull();
    expect(mockValidateNeonSessionFromToken).not.toHaveBeenCalled();
    expect.assertions(3);
  });

  it('skips cookie validation entirely in E2E test mode', async () => {
    mockEnv.E2E_TEST_MODE = '1';
    const event = createMockRequestEvent();
    event.cookies.get = vi.fn(() => 'some-token');

    const { authHandle } = await import('./hooks.server');
    const response = await authHandle({ event, resolve: () => new Response('ok') });

    expect(response.status).toBe(200);
    expect(mockValidateNeonSessionFromToken).not.toHaveBeenCalled();
    expect.assertions(2);
  });
});

describe('correlationHandle (isolated from the composed handle via a mocked sequence())', () => {
  it('injects a correlation id and request id, and echoes them as response headers', async () => {
    const { handle } = await import('./hooks.server');
    const event = createMockRequestEvent();

    const response = (await handle({
      event,
      resolve: () => new Response('ok'),
    } as never)) as Response;

    expect(event.locals.correlationId).toMatch(/^corr-/);
    expect(event.locals.requestId).toMatch(/^req-/);
    expect(response.headers.get('X-Correlation-ID')).toBe(event.locals.correlationId);
    expect(response.headers.get('X-Request-ID')).toBe(event.locals.requestId);
    expect.assertions(4);
  });

  it('reuses an incoming X-Correlation-Id header instead of generating a new one', async () => {
    const { handle } = await import('./hooks.server');
    const event = createMockRequestEvent({ headers: { 'x-correlation-id': 'incoming-corr-id' } });

    const response = (await handle({
      event,
      resolve: () => new Response('ok'),
    } as never)) as Response;

    expect(response.headers.get('X-Correlation-ID')).toBe('incoming-corr-id');
    expect.assertions(1);
  });
});

describe('init (server startup hook)', () => {
  beforeEach(() => {
    mockEnv.E2E_TEST_MODE = '0';
    mockApplicationEnvironment.building = false;
    mockApplicationEnvironment.dev = true;
    mockAssertNeonAuthConfigured.mockReset();
    mockWarnOnGitHubAppConfigurationDriftAtStartup.mockReset();
    mockWarnOnGitHubAppConfigurationDriftAtStartup.mockResolvedValue(undefined);
  });

  it('requires Neon Auth configuration outside development', async () => {
    mockApplicationEnvironment.dev = false;

    const { init } = await import('./hooks.server');
    await init();

    expect(mockAssertNeonAuthConfigured).toHaveBeenCalledTimes(1);
  });

  it('does not require runtime configuration while SvelteKit is building', async () => {
    mockApplicationEnvironment.building = true;
    mockApplicationEnvironment.dev = false;

    const { init } = await import('./hooks.server');
    await init();

    expect(mockAssertNeonAuthConfigured).not.toHaveBeenCalled();
  });

  it('does not require production identity configuration in E2E preview mode', async () => {
    mockApplicationEnvironment.dev = false;
    mockEnv.E2E_TEST_MODE = '1';

    const { init } = await import('./hooks.server');
    await init();

    expect(mockAssertNeonAuthConfigured).not.toHaveBeenCalled();
  });

  it('fires the webhook subscription drift check without awaiting it', async () => {
    let resolveDriftCheck: () => void = () => {};
    mockWarnOnGitHubAppConfigurationDriftAtStartup.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveDriftCheck = resolve;
      }),
    );

    const { init } = await import('./hooks.server');
    // If `init` awaited the drift check internally, this would hang forever
    // since the mocked promise above is never resolved before this call.
    await init();

    expect(mockWarnOnGitHubAppConfigurationDriftAtStartup).toHaveBeenCalledTimes(1);
    resolveDriftCheck();
  });

  it('logs rather than throws when the drift check rejects', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockWarnOnGitHubAppConfigurationDriftAtStartup.mockRejectedValue(new Error('boom'));

    const { init } = await import('./hooks.server');
    await init();
    // Let the un-awaited promise's .catch handler run.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(errorSpy).toHaveBeenCalledWith(
      '[github-app-configuration] Unexpected error during startup drift check:',
      expect.any(Error),
    );
  });
});
