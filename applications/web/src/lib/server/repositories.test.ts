import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDatabase, type TestDatabase } from '@tribunal/test/database';
import { runWithDatabase } from '$lib/server/database';

const { mockEnv, mockGithubRequest } = vi.hoisted(() => ({
  mockEnv: {
    GITHUB_APP_NAME: 'tribunal-review',
    NODE_ENV: 'test',
    E2E_TEST_MODE: '0',
    E2E_TEST_SECRET: '',
  },
  mockGithubRequest: vi.fn(),
}));

vi.mock('$env/dynamic/private', () => ({
  get env() {
    return mockEnv;
  },
}));

vi.mock('$lib/server/github/user-oauth', () => ({
  getUserOctokit: vi.fn(() =>
    Promise.resolve({
      ok: true,
      octokit: {
        request: mockGithubRequest,
      },
      scopes: {},
    }),
  ),
}));

import { getRepositoriesForUser } from './repositories';

describe('getRepositoriesForUser', () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await createTestDatabase();
  }, 30_000);

  afterAll(async () => {
    await testDb.close();
  });

  beforeEach(async () => {
    await testDb.reset();
    mockEnv.GITHUB_APP_NAME = 'tribunal-review';
    mockEnv.NODE_ENV = 'test';
    mockEnv.E2E_TEST_MODE = '0';
    mockEnv.E2E_TEST_SECRET = '';
    mockGithubRequest.mockReset();
    mockGithubRequest.mockImplementation(async (endpoint: string, options?: { page?: number }) => {
      if (endpoint !== 'GET /user/installations') {
        throw new Error(`Unexpected GitHub endpoint: ${endpoint}`);
      }

      return {
        data: {
          installations:
            (options?.page ?? 1) === 1
              ? [
                  {
                    id: 12345,
                    app_slug: 'tribunal-review',
                    account: {
                      login: 'test-org',
                      avatar_url: 'https://example.test/test-org.png',
                    },
                  },
                ]
              : [],
        },
      };
    });
  });

  function withTestDatabase<T>(operation: () => Promise<T>): Promise<T> {
    return runWithDatabase(testDb.db as never, operation);
  }

  it('returns live GitHub App installations before local installation rows are synced', async () => {
    const result = await withTestDatabase(() => getRepositoriesForUser(1));

    expect(result).toMatchObject({
      ok: true,
      repositories: [],
      installations: [
        {
          installationId: 12345,
          accountLogin: 'test-org',
          accountAvatarUrl: 'https://example.test/test-org.png',
        },
      ],
    });
    expect.assertions(1);
  });

  it('ignores live installations for other GitHub Apps', async () => {
    mockGithubRequest.mockImplementation(async (endpoint: string, options?: { page?: number }) => {
      if (endpoint !== 'GET /user/installations') {
        throw new Error(`Unexpected GitHub endpoint: ${endpoint}`);
      }

      return {
        data: {
          installations:
            (options?.page ?? 1) === 1
              ? [
                  {
                    id: 67890,
                    app_slug: 'other-app',
                    account: {
                      login: 'other-org',
                      avatar_url: 'https://example.test/other-org.png',
                    },
                  },
                ]
              : [],
        },
      };
    });

    const result = await withTestDatabase(() => getRepositoriesForUser(1));

    expect(result).toMatchObject({
      ok: true,
      repositories: [],
      installations: [],
    });
    expect.assertions(1);
  });

  it('maps a 401 from GitHub to no_github_token (revoked/expired token)', async () => {
    // A 401 means the stored OAuth token is dead. It must surface as
    // `no_github_token` (a reconnect prompt) — not `github_unavailable`, which
    // would imply a transient outage and re-use the dead token on every load.
    mockGithubRequest.mockImplementation(async () => {
      throw Object.assign(new Error('Bad credentials'), { status: 401 });
    });

    const result = await withTestDatabase(() => getRepositoriesForUser(1));

    expect(result).toMatchObject({ ok: false, error: 'no_github_token' });
    expect.assertions(1);
  });

  it('maps a non-401 GitHub error to github_unavailable (transient)', async () => {
    mockGithubRequest.mockImplementation(async () => {
      throw Object.assign(new Error('Service unavailable'), { status: 503 });
    });

    const result = await withTestDatabase(() => getRepositoriesForUser(1));

    expect(result).toMatchObject({ ok: false, error: 'github_unavailable' });
    expect.assertions(1);
  });

  it('uses live GitHub installations in production even if E2E variables are present', async () => {
    mockEnv.NODE_ENV = 'production';
    mockEnv.E2E_TEST_MODE = '1';
    mockEnv.E2E_TEST_SECRET = 'secret';

    const result = await withTestDatabase(() => getRepositoriesForUser(1));

    expect(result).toMatchObject({
      ok: true,
      repositories: [],
      installations: [
        {
          installationId: 12345,
          accountLogin: 'test-org',
          accountAvatarUrl: 'https://example.test/test-org.png',
        },
      ],
    });
  });
});
