import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { App } from 'octokit';
import type { GithubServiceContext } from '../context.js';
import { RateLimitError, ServiceUnavailableError, ValidationError } from '../error-taxonomy.js';
import {
  decryptInstallationToken,
  encryptInstallationToken,
  mintSingleRepositoryReadToken,
} from './read-tokens.js';

const originalEncryptionKey = process.env.ENCRYPTION_KEY;

beforeEach(() => {
  process.env.ENCRYPTION_KEY = 'a'.repeat(64);
});

afterEach(() => {
  if (originalEncryptionKey === undefined) {
    delete process.env.ENCRYPTION_KEY;
  } else {
    process.env.ENCRYPTION_KEY = originalEncryptionKey;
  }
});

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
  it('requests one repository with contents:read permission', async () => {
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
    const cachedEnvelope = vi.mocked(context.cache.setCache).mock.calls[0]?.[1];
    expect(JSON.stringify(cachedEnvelope)).not.toContain('opaque-token-with-no-assumed-format');
    expect(JSON.stringify(cachedEnvelope)).toContain('encryptedToken');
    expect(createInstallationAccessToken).toHaveBeenCalledWith({
      installation_id: 123,
      repository_ids: [456],
      permissions: {
        contents: 'read',
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
    const cachedToken = encryptInstallationToken({
      token: 'x',
      expiresAt: '2026-01-01T00:00:00Z',
      installationId: 123,
    });
    vi.mocked(context.cache.getCached).mockResolvedValue({
      value: cachedToken,
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

  it('rejects malformed encrypted cached tokens', () => {
    expect(() =>
      decryptInstallationToken({
        encryptedToken: 'not-encrypted',
        expiresAt: '2026-01-01T00:00:00Z',
        installationId: 123,
      }),
    ).toThrow('Cached GitHub installation token is not encrypted.');
  });

  it('requires a valid encryption key before caching tokens', () => {
    delete process.env.ENCRYPTION_KEY;

    expect(() =>
      encryptInstallationToken({
        token: 'x',
        expiresAt: '2026-01-01T00:00:00Z',
        installationId: 123,
      }),
    ).toThrow('ENCRYPTION_KEY is required to cache GitHub tokens.');

    process.env.ENCRYPTION_KEY = 'a'.repeat(62);

    expect(() =>
      encryptInstallationToken({
        token: 'x',
        expiresAt: '2026-01-01T00:00:00Z',
        installationId: 123,
      }),
    ).toThrow('ENCRYPTION_KEY must be 32 bytes');
  });
});
