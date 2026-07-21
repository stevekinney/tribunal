import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockRequestEvent } from '$lib/test-utils/request-event';

const mockValidateNeonSessionFromToken = vi.hoisted(() => vi.fn());
const mockDeleteNeonAuthTokenCookie = vi.hoisted(() => vi.fn());
const mockEnv = vi.hoisted(() => ({ E2E_TEST_MODE: '0' }));

vi.mock('$env/dynamic/private', () => ({ env: mockEnv }));

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

vi.mock(import('$lib/server/auth/neon-session'), () => ({
  neonAuthTokenCookieName: 'tribunal-neon-auth-token' as const,
  validateNeonSessionFromToken: mockValidateNeonSessionFromToken,
  deleteNeonAuthTokenCookie: mockDeleteNeonAuthTokenCookie,
}));

describe('hooks auth handle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnv.E2E_TEST_MODE = '0';
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
