import { describe, expect, it, vi } from 'vitest';
import type { App } from 'octokit';
import type { GithubServiceContext } from '../context.js';
import { RateLimitError, ServiceUnavailableError, ValidationError } from '../error-taxonomy.js';
import { mintSingleRepositoryReadToken } from './read-tokens.js';

function createContext(app: App): GithubServiceContext {
  return {
    db: {} as GithubServiceContext['db'],
    cache: {
      getCached: vi.fn().mockResolvedValue(null),
      setCache: vi.fn().mockResolvedValue(true),
      setCacheIndefinitely: vi.fn().mockResolvedValue(true),
      deleteCache: vi.fn().mockResolvedValue(true),
      deleteCacheByPattern: vi.fn().mockResolvedValue(0),
      resetCacheClient: vi.fn(),
    },
    getInstallationOctokit: vi.fn().mockResolvedValue(null),
    getGithubApplication: vi.fn().mockReturnValue(app),
  };
}

function octokitError(status: number, message: string, headers: Record<string, string> = {}) {
  return Object.assign(new Error(message), {
    status,
    response: {
      data: { message },
      headers,
    },
  });
}

describe('mintSingleRepositoryReadToken', () => {
  it('requests one repository with contents:read and metadata:read permissions', async () => {
    const createInstallationAccessToken = vi.fn().mockResolvedValue({
      data: {
        token: 'opaque-token-with-no-assumed-format',
        expires_at: '2026-01-01T00:00:00Z',
      },
    });
    const app = {
      octokit: {
        rest: {
          apps: {
            createInstallationAccessToken,
          },
        },
      },
    } as unknown as App;
    const context = createContext(app);

    const result = await mintSingleRepositoryReadToken(context, {
      installationId: 123,
      repositoryId: 456,
    });

    expect(result.token).toBe('opaque-token-with-no-assumed-format');
    expect(createInstallationAccessToken).toHaveBeenCalledWith({
      installation_id: 123,
      repository_ids: [456],
      permissions: {
        contents: 'read',
        metadata: 'read',
      },
    });
  });

  it('returns cached tokens without assuming token shape or length', async () => {
    const app = {
      octokit: {
        rest: {
          apps: {
            createInstallationAccessToken: vi.fn(),
          },
        },
      },
    } as unknown as App;
    const context = createContext(app);
    vi.mocked(context.cache.getCached).mockResolvedValue({
      value: {
        token: 'x',
        expiresAt: '2026-01-01T00:00:00Z',
        installationId: 123,
      },
      fetchedAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      source: 'api',
    });

    const result = await mintSingleRepositoryReadToken(context, {
      installationId: 123,
      repositoryId: 456,
    });

    expect(result.token).toBe('x');
    expect(app.octokit.rest.apps.createInstallationAccessToken).not.toHaveBeenCalled();
  });

  it('maps rate-limited token minting failures to RateLimitError', async () => {
    const app = {
      octokit: {
        rest: {
          apps: {
            createInstallationAccessToken: vi
              .fn()
              .mockRejectedValue(octokitError(429, 'secondary rate limit', { 'Retry-After': '9' })),
          },
        },
      },
    } as unknown as App;
    const context = createContext(app);

    await expect(
      mintSingleRepositoryReadToken(context, {
        installationId: 123,
        repositoryId: 456,
      }),
    ).rejects.toMatchObject({
      name: RateLimitError.name,
      retryAfterSeconds: 9,
    });
  });

  it('maps retryable token minting failures to ServiceUnavailableError', async () => {
    const app = {
      octokit: {
        rest: {
          apps: {
            createInstallationAccessToken: vi
              .fn()
              .mockRejectedValue(octokitError(503, 'GitHub down')),
          },
        },
      },
    } as unknown as App;
    const context = createContext(app);

    await expect(
      mintSingleRepositoryReadToken(context, {
        installationId: 123,
        repositoryId: 456,
      }),
    ).rejects.toThrow(ServiceUnavailableError);
  });

  it('maps non-retryable token minting failures to ValidationError', async () => {
    const app = {
      octokit: {
        rest: {
          apps: {
            createInstallationAccessToken: vi.fn().mockRejectedValue(octokitError(404, 'missing')),
          },
        },
      },
    } as unknown as App;
    const context = createContext(app);

    await expect(
      mintSingleRepositoryReadToken(context, {
        installationId: 123,
        repositoryId: 456,
      }),
    ).rejects.toThrow(ValidationError);
  });
});
