import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockRequestEvent } from '$lib/test-utils/request-event';

const mockCreateNeonSessionFromToken = vi.hoisted(() => vi.fn());
const mockDeleteNeonAuthTokenCookie = vi.hoisted(() => vi.fn());

vi.mock('$env/dynamic/private', () => ({
  env: {
    E2E_TEST_MODE: '0',
  },
}));

vi.mock('$testing/end-to-end/handle', () => ({
  e2eHandle: async ({
    event,
    resolve,
  }: {
    event: unknown;
    resolve: (event: never) => Response | Promise<Response>;
  }) => resolve(event as never),
}));

vi.mock('$lib/server/auth/neon-session', () => ({
  neonAuthTokenCookieName: 'tribunal-neon-auth-token',
  createNeonSessionFromToken: mockCreateNeonSessionFromToken,
  deleteNeonAuthTokenCookie: mockDeleteNeonAuthTokenCookie,
}));

describe('hooks auth handle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    mockCreateNeonSessionFromToken.mockResolvedValueOnce({ user, neonSession });

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
    expect(mockCreateNeonSessionFromToken).toHaveBeenCalledWith('valid-token');
    expect.assertions(4);
  });

  it('clears invalid Neon Auth bridge cookies', async () => {
    mockCreateNeonSessionFromToken.mockRejectedValueOnce(new Error('invalid token'));

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
});
