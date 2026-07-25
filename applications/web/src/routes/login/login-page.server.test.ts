import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockIsNeonAuthConfigured } = vi.hoisted(() => ({
  mockIsNeonAuthConfigured: vi.fn(),
}));

vi.mock('@sveltejs/kit', () => ({
  redirect: (status: number, location: string) => {
    throw { status, location, type: 'redirect' };
  },
}));

vi.mock('$lib/server/auth/neon-auth-configured', () => ({
  isNeonAuthConfigured: mockIsNeonAuthConfigured,
}));

import { load } from './+page.server';

describe('/login load', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('redirects to / when a user is already signed in and no returnTo is given', async () => {
    await expect(
      load({
        locals: { user: { id: 1 } },
        url: new URL('http://localhost/login'),
      } as never),
    ).rejects.toMatchObject({ status: 302, location: '/' });
    expect(mockIsNeonAuthConfigured).not.toHaveBeenCalled();
  });

  it('preserves a sanitized returnTo when a user is already signed in', async () => {
    // Covers a transient infrastructure failure (see hooks.server.ts's
    // TransientAuthInfrastructureError handling): the request that bounced
    // the user to /login?returnTo=... failed validation, but the retained
    // cookie is still valid on this request, so the user lands here already
    // authenticated. Losing returnTo here would silently drop their
    // original destination.
    await expect(
      load({
        locals: { user: { id: 1 } },
        url: new URL('http://localhost/login?returnTo=%2Frepositories%2F42'),
      } as never),
    ).rejects.toMatchObject({ status: 302, location: '/repositories/42' });
  });

  it('falls back to / for an unsafe returnTo when a user is already signed in', async () => {
    await expect(
      load({
        locals: { user: { id: 1 } },
        url: new URL('http://localhost/login?returnTo=https%3A%2F%2Fevil.example.com'),
      } as never),
    ).rejects.toMatchObject({ status: 302, location: '/' });
  });

  it('returns Neon Auth configuration for a signed-out visitor', async () => {
    mockIsNeonAuthConfigured.mockReturnValue(true);

    const data = await load({ locals: {}, url: new URL('http://localhost/login') } as never);

    expect(data).toEqual({ neonAuthConfigured: true });
  });
});
