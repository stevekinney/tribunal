import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockRepositoriesResult } = vi.hoisted(() => ({
  mockRepositoriesResult: {
    value: {
      ok: true,
      repositories: [],
      installations: [],
    } as
      | {
          ok: true;
          repositories: [];
          installations: [];
        }
      | {
          ok: false;
          error: 'no_github_token' | 'github_unavailable';
          message: string;
        },
  },
}));

vi.mock('@sveltejs/kit', () => ({
  redirect: (status: number, location: string) => {
    throw { status, location, type: 'redirect' };
  },
}));

vi.mock('$lib/server/repositories', () => ({
  getRepositoriesForUser: vi.fn(() => Promise.resolve(mockRepositoriesResult.value)),
}));

import { load } from './+page.server';

type RepositoriesLoadResult = {
  needsConnect: boolean;
  loadError: string | null;
};

describe('/repositories server load', () => {
  beforeEach(() => {
    mockRepositoriesResult.value = {
      ok: true,
      repositories: [],
      installations: [],
    };
  });

  function createEvent(search = '') {
    return {
      url: new URL(`http://localhost/repositories${search}`),
      locals: {
        user: {
          id: 1,
          username: 'test-user',
        },
      },
    } as Parameters<typeof load>[0];
  }

  it('surfaces GitHub OAuth configuration errors from the query string', async () => {
    const result = (await load(
      createEvent('?error=github_oauth_not_configured'),
    )) as RepositoriesLoadResult;

    expect(result.loadError).toBe(
      'GitHub OAuth is not configured. Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET, then restart the development server.',
    );
    expect.assertions(1);
  });

  it('keeps query-string errors visible even when repository resolution also needs reconnect', async () => {
    mockRepositoriesResult.value = {
      ok: false,
      error: 'no_github_token',
      message: 'Reconnect GitHub.',
    };

    const result = (await load(
      createEvent('?error=github_redirect_uri_not_configured'),
    )) as RepositoriesLoadResult;

    expect(result.needsConnect).toBe(true);
    expect(result.loadError).toBe(
      'GitHub OAuth redirect URI is not configured. Set GITHUB_REDIRECT_URI outside local development.',
    );
    expect.assertions(2);
  });
});
