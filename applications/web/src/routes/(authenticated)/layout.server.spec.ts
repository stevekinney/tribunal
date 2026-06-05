import { describe, expect, it, vi } from 'vitest';

vi.mock('@sveltejs/kit', () => ({
  redirect: (status: number, location: string) => {
    throw { status, location, type: 'redirect' };
  },
}));

import { load } from './+layout.server';

describe('(authenticated) layout server load', () => {
  it('redirects when no valid Neon session exists', async () => {
    const event = {
      locals: {
        user: null,
        neonSession: null,
      },
      url: new URL('http://localhost/repositories?filter=open'),
    } as Parameters<typeof load>[0];

    await expect(load(event)).rejects.toMatchObject({
      status: 302,
      location: '/login?returnTo=%2Frepositories%3Ffilter%3Dopen',
    });
    expect.assertions(1);
  });
});
