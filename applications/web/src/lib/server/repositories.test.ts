import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDatabase, type TestDatabase } from '@tribunal/test/database';
import { runWithDatabase } from '$lib/server/database';

const { mockEnv, mockGithubRequest } = vi.hoisted(() => ({
  mockEnv: {
    GITHUB_APP_NAME: 'tribunal-review',
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
});
