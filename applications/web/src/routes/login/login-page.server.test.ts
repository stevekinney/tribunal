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

  it('redirects to / when a user is already signed in', async () => {
    await expect(load({ locals: { user: { id: 1 } } } as never)).rejects.toMatchObject({
      status: 302,
      location: '/',
    });
    expect(mockIsNeonAuthConfigured).not.toHaveBeenCalled();
  });

  it('returns Neon Auth configuration for a signed-out visitor', async () => {
    mockIsNeonAuthConfigured.mockReturnValue(true);

    const data = await load({ locals: {} } as never);

    expect(data).toEqual({ neonAuthConfigured: true });
  });
});
