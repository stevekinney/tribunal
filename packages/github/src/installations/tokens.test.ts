import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ValidationError } from '../error-taxonomy.js';
import type { App } from 'octokit';
import type { GithubServiceContext } from '../context.js';
import * as installationTokens from './tokens.js';

function createMockContext(overrides?: Partial<GithubServiceContext>): GithubServiceContext {
  return {
    db: {} as any,
    cache: {
      getCached: vi.fn().mockResolvedValue(null),
      setCache: vi.fn().mockResolvedValue(true),
      setCacheIndefinitely: vi.fn().mockResolvedValue(true),
      deleteCache: vi.fn().mockResolvedValue(true),
      deleteCacheByPattern: vi.fn().mockResolvedValue(0),
      resetCacheClient: vi.fn(),
    },
    getInstallationOctokit: vi.fn().mockResolvedValue(null),
    getGithubApplication: vi.fn().mockReturnValue(null),
    ...overrides,
  };
}

describe('mintInstallationAccessToken', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('throws ValidationError when getGithubApplication() returns null', async () => {
    const context = createMockContext({
      getGithubApplication: vi.fn().mockReturnValue(null),
    });

    await expect(
      installationTokens.mintInstallationAccessToken(context, { installationId: 42 }),
    ).rejects.toThrow(ValidationError);
  });

  it('delegates to createInstallationToken with correct args', async () => {
    const createInstallationAccessToken = vi.fn().mockResolvedValue({
      data: { token: 'ghs_test', expires_at: '2025-01-01T01:00:00Z' },
    });
    const fakeApp = {
      octokit: {
        rest: {
          apps: {
            createInstallationAccessToken,
          },
        },
      },
    } as unknown as App;
    const context = createMockContext({
      getGithubApplication: vi.fn().mockReturnValue(fakeApp),
    });

    const options = {
      installationId: 42,
      repositoryIds: [100],
      permissions: { contents: 'read' as const },
    };

    await installationTokens.mintInstallationAccessToken(context, options);

    expect(createInstallationAccessToken).toHaveBeenCalledWith({
      installation_id: 42,
      repository_ids: [100],
      permissions: { contents: 'read' },
    });
  });

  it('returns core result when app is configured', async () => {
    const fakeApp = {
      octokit: {
        rest: {
          apps: {
            createInstallationAccessToken: vi.fn().mockResolvedValue({
              data: { token: 'ghs_test', expires_at: '2025-01-01T01:00:00Z' },
            }),
          },
        },
      },
    } as unknown as App;
    const context = createMockContext({
      getGithubApplication: vi.fn().mockReturnValue(fakeApp),
    });

    const result = await installationTokens.mintInstallationAccessToken(context, {
      installationId: 42,
    });

    expect(result).toEqual({
      ok: true,
      token: { token: 'ghs_test', expiresAt: '2025-01-01T01:00:00Z', installationId: 42 },
    });
  });

  it('returns error result from core when API fails', async () => {
    const error = Object.assign(new Error('Not Found'), {
      status: 404,
      response: { data: { message: 'Not Found' }, headers: {} },
    });
    const fakeApp = {
      octokit: {
        rest: {
          apps: {
            createInstallationAccessToken: vi.fn().mockRejectedValue(error),
          },
        },
      },
    } as unknown as App;
    const context = createMockContext({
      getGithubApplication: vi.fn().mockReturnValue(fakeApp),
    });

    const result = await installationTokens.mintInstallationAccessToken(context, {
      installationId: 42,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('not_found');
      expect(result.error.installationId).toBe(42);
      expect(result.error.message).toContain('Installation 42 not found');
    }
  });
});
