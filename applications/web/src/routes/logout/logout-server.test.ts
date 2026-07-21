import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockDeleteNeonAuthTokenCookie } = vi.hoisted(() => ({
  mockDeleteNeonAuthTokenCookie: vi.fn(),
}));

vi.mock('@sveltejs/kit', () => ({
  redirect: (status: number, location: string) => {
    throw { status, location, type: 'redirect' };
  },
}));

vi.mock('$lib/server/auth/neon-session', () => ({
  deleteNeonAuthTokenCookie: mockDeleteNeonAuthTokenCookie,
}));

import { POST } from './+server';

describe('POST /logout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deletes the Neon auth token cookie and redirects to /', async () => {
    const cookies = { delete: vi.fn() };

    await expect(POST({ cookies } as never)).rejects.toMatchObject({
      status: 302,
      location: '/',
    });
    expect(mockDeleteNeonAuthTokenCookie).toHaveBeenCalledWith({ cookies });
  });
});
