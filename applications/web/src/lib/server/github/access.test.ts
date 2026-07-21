import { describe, it, expect, vi } from 'vitest';
import {
  parseScopes,
  parseSsoHeader,
  shouldCacheDenial,
  type UserScopes,
  type GitHubAccessResult,
  type GitHubAccessDenialReason,
} from './access';

// Mock external dependencies
vi.mock('$env/dynamic/private', () => ({
  env: {
    GITHUB_ACCESS_CACHE_TTL: '300',
  },
}));

vi.mock('../database', () => ({
  db: {
    select: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock('../auth/authentication', () => ({
  getOAuthConnection: vi.fn(),
}));

vi.mock('../redis', () => ({
  getCached: vi.fn(),
  setCache: vi.fn(),
  deleteCache: vi.fn(),
  deleteCacheByPattern: vi.fn(),
}));

describe('parseScopes', () => {
  it('returns unknown when scope is null', () => {
    expect.assertions(1);
    const result = parseScopes(null);
    expect(result).toEqual({
      hasRepo: false,
      hasPublicRepo: false,
      hasNone: false,
      unknown: true,
    });
  });

  it('returns unknown when scope is empty string', () => {
    expect.assertions(1);
    const result = parseScopes('');
    expect(result).toEqual({
      hasRepo: false,
      hasPublicRepo: false,
      hasNone: false,
      unknown: true,
    });
  });

  it('detects repo scope', () => {
    expect.assertions(1);
    const result = parseScopes('repo, user:email');
    expect(result).toEqual({
      hasRepo: true,
      hasPublicRepo: false,
      hasNone: false,
      unknown: false,
    });
  });

  it('detects public_repo scope', () => {
    expect.assertions(1);
    const result = parseScopes('public_repo, user:email');
    expect(result).toEqual({
      hasRepo: false,
      hasPublicRepo: true,
      hasNone: false,
      unknown: false,
    });
  });

  it('detects hasNone when only user:email scope', () => {
    expect.assertions(1);
    const result = parseScopes('user:email');
    expect(result).toEqual({
      hasRepo: false,
      hasPublicRepo: false,
      hasNone: true,
      unknown: false,
    });
  });

  it('handles multiple scopes with repo', () => {
    expect.assertions(1);
    const result = parseScopes('user:email, repo, read:org');
    expect(result).toEqual({
      hasRepo: true,
      hasPublicRepo: false,
      hasNone: false,
      unknown: false,
    });
  });

  it('handles case-insensitive scopes', () => {
    expect.assertions(1);
    const result = parseScopes('REPO, User:Email');
    expect(result).toEqual({
      hasRepo: true,
      hasPublicRepo: false,
      hasNone: false,
      unknown: false,
    });
  });

  it('handles comma-separated scopes without spaces', () => {
    expect.assertions(1);
    const result = parseScopes('repo,user:email,read:org');
    expect(result).toEqual({
      hasRepo: true,
      hasPublicRepo: false,
      hasNone: false,
      unknown: false,
    });
  });
});

describe('parseSsoHeader', () => {
  it('returns null for invalid header', () => {
    expect.assertions(1);
    const result = parseSsoHeader('invalid header');
    expect(result).toBeNull();
  });

  it('returns null for empty header', () => {
    expect.assertions(1);
    const result = parseSsoHeader('');
    expect(result).toBeNull();
  });

  it('parses required SSO header correctly', () => {
    expect.assertions(1);
    const header =
      'required; url=https://github.com/orgs/acme-corp/sso?authorization_request=abc123';
    const result = parseSsoHeader(header);
    expect(result).toEqual({
      type: 'required',
      orgLogin: 'acme-corp',
      authUrl: 'https://github.com/orgs/acme-corp/sso?authorization_request=abc123',
    });
  });

  it('parses partial-results SSO header correctly', () => {
    expect.assertions(1);
    const header =
      'partial-results; url=https://github.com/orgs/my-org/sso?authorization_request=xyz789';
    const result = parseSsoHeader(header);
    expect(result).toEqual({
      type: 'partial-results',
      orgLogin: 'my-org',
      authUrl: 'https://github.com/orgs/my-org/sso?authorization_request=xyz789',
    });
  });

  it('handles org names with dashes', () => {
    expect.assertions(1);
    const header = 'required; url=https://github.com/orgs/my-super-org/sso?auth=123';
    const result = parseSsoHeader(header);
    expect(result).toEqual({
      type: 'required',
      orgLogin: 'my-super-org',
      authUrl: 'https://github.com/orgs/my-super-org/sso?auth=123',
    });
  });

  it('returns null when org cannot be extracted', () => {
    expect.assertions(1);
    const header = 'required; url=https://github.com/invalid-url';
    const result = parseSsoHeader(header);
    expect(result).toBeNull();
  });
});

describe('GitHubAccessResult types', () => {
  it('allowed result has visibility', () => {
    expect.assertions(2);
    const result: GitHubAccessResult = { allowed: true, visibility: 'public' };
    expect(result.allowed).toBe(true);
    expect(result.visibility).toBe('public');
  });

  it('denied result has reason and message', () => {
    expect.assertions(3);
    const result: GitHubAccessResult = {
      allowed: false,
      reason: 'no_token',
      message: 'No token',
    };
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('no_token');
    expect(result.message).toBe('No token');
  });

  it('SSO denied result has ssoUrl and ssoOrgLogin', () => {
    expect.assertions(5);
    const result: GitHubAccessResult = {
      allowed: false,
      reason: 'sso_required',
      message: 'SSO required',
      ssoUrl: 'https://github.com/orgs/acme/sso',
      ssoOrgLogin: 'acme',
    };
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('sso_required');
    expect(result.ssoUrl).toBe('https://github.com/orgs/acme/sso');
    expect(result.ssoOrgLogin).toBe('acme');
    expect(result.message).toBe('SSO required');
  });

  it('rate limited result has retryAfter', () => {
    expect.assertions(3);
    const result: GitHubAccessResult = {
      allowed: false,
      reason: 'rate_limited',
      message: 'Rate limited',
      retryAfter: 60,
    };
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('rate_limited');
    expect(result.retryAfter).toBe(60);
  });
});

describe('UserScopes types', () => {
  it('validates UserScopes structure', () => {
    expect.assertions(4);
    const scopes: UserScopes = {
      hasRepo: true,
      hasPublicRepo: false,
      hasNone: false,
      unknown: false,
    };
    expect(scopes.hasRepo).toBe(true);
    expect(scopes.hasPublicRepo).toBe(false);
    expect(scopes.hasNone).toBe(false);
    expect(scopes.unknown).toBe(false);
  });
});

describe('shouldCacheDenial', () => {
  const fullScopes: UserScopes = {
    hasRepo: true,
    hasPublicRepo: false,
    hasNone: false,
    unknown: false,
  };
  const minimalScopes: UserScopes = {
    hasRepo: false,
    hasPublicRepo: true,
    hasNone: false,
    unknown: false,
  };
  const noScopes: UserScopes = {
    hasRepo: false,
    hasPublicRepo: false,
    hasNone: true,
    unknown: false,
  };
  const unknownScopes: UserScopes = {
    hasRepo: false,
    hasPublicRepo: false,
    hasNone: false,
    unknown: true,
  };

  it('never caches an invalid_token denial (user may reauth)', () => {
    expect(shouldCacheDenial('invalid_token', fullScopes, undefined)).toEqual({
      cache: false,
      ttl: 0,
    });
  });

  it('never caches a rate_limited denial (transient)', () => {
    expect(shouldCacheDenial('rate_limited', fullScopes, undefined)).toEqual({
      cache: false,
      ttl: 0,
    });
  });

  it('caches an sso_required denial with the short SSO TTL', () => {
    expect(shouldCacheDenial('sso_required', fullScopes, undefined)).toEqual({
      cache: true,
      ttl: 60,
    });
  });

  it('never caches an insufficient_scope denial (user may upgrade)', () => {
    expect(shouldCacheDenial('insufficient_scope', fullScopes, undefined)).toEqual({
      cache: false,
      ttl: 0,
    });
  });

  it('does not cache no_access when there was a recent success (GitHub wobble)', () => {
    const lastSuccessAt = Date.now() - 1000;
    expect(shouldCacheDenial('no_access', fullScopes, lastSuccessAt)).toEqual({
      cache: false,
      ttl: 0,
    });
  });

  it('does not cache no_access when scope is minimal/unknown (might need upgrade)', () => {
    expect(shouldCacheDenial('no_access', minimalScopes, undefined)).toEqual({
      cache: false,
      ttl: 0,
    });
  });

  it('does not cache no_access when the user has no scopes at all', () => {
    expect(shouldCacheDenial('no_access', noScopes, undefined)).toEqual({
      cache: false,
      ttl: 0,
    });
  });

  it('does not cache no_access when scope could not be determined', () => {
    expect(shouldCacheDenial('no_access', unknownScopes, undefined)).toEqual({
      cache: false,
      ttl: 0,
    });
  });

  it('caches no_access with the standard TTL when scope is full and there was no recent success', () => {
    expect(shouldCacheDenial('no_access', fullScopes, undefined)).toEqual({
      cache: true,
      ttl: 300,
    });
  });

  it('treats a stale lastSuccessAt (over an hour ago) as not a recent success', () => {
    const lastSuccessAt = Date.now() - 3600_001;
    expect(shouldCacheDenial('no_access', fullScopes, lastSuccessAt)).toEqual({
      cache: true,
      ttl: 300,
    });
  });

  it('caches a repository_blocked denial for 5 minutes', () => {
    expect(shouldCacheDenial('repository_blocked', fullScopes, undefined)).toEqual({
      cache: true,
      ttl: 300,
    });
  });

  it('caches an account_suspended denial for 5 minutes', () => {
    expect(shouldCacheDenial('account_suspended', fullScopes, undefined)).toEqual({
      cache: true,
      ttl: 300,
    });
  });

  it('never caches a no_token denial (user may connect)', () => {
    expect(shouldCacheDenial('no_token', fullScopes, undefined)).toEqual({
      cache: false,
      ttl: 0,
    });
  });

  it('never caches an unrecognized denial reason', () => {
    const unrecognized = 'not-a-real-reason' as GitHubAccessDenialReason;
    expect(shouldCacheDenial(unrecognized, fullScopes, undefined)).toEqual({
      cache: false,
      ttl: 0,
    });
  });
});

describe('markGitHubTokensInvalidByProviderUserId', () => {
  it('returns empty array when no connections exist', async () => {
    const { db } = await import('../database');

    // Mock the update().returning() chain to return empty array
    vi.mocked(db.update).mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([]),
        }),
      }),
    } as unknown as ReturnType<typeof db.update>);

    const { markGitHubTokensInvalidByProviderUserId } = await import('./access');
    const result = await markGitHubTokensInvalidByProviderUserId(12345);

    expect(result).toEqual([]);
  });

  it('marks connections as invalid and returns affected user IDs', async () => {
    const { db } = await import('../database');

    // Mock the update().returning() chain to return affected users
    vi.mocked(db.update).mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ userId: 1 }, { userId: 2 }]),
        }),
      }),
    } as unknown as ReturnType<typeof db.update>);

    const { markGitHubTokensInvalidByProviderUserId } = await import('./access');
    const result = await markGitHubTokensInvalidByProviderUserId(12345);

    expect(result).toEqual([1, 2]);
  });

  it('returns empty array on database error', async () => {
    const { db } = await import('../database');
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Mock the update() to throw an error
    vi.mocked(db.update).mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockRejectedValue(new Error('Database error')),
        }),
      }),
    } as unknown as ReturnType<typeof db.update>);

    const { markGitHubTokensInvalidByProviderUserId } = await import('./access');
    const result = await markGitHubTokensInvalidByProviderUserId(12345);

    expect(result).toEqual([]);
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});

describe('invalidateAllAccessCacheForRepo', () => {
  it('deletes every cached access entry for the repository across all users', async () => {
    const { deleteCacheByPattern } = await import('../redis');
    vi.mocked(deleteCacheByPattern).mockResolvedValue(0);

    const { invalidateAllAccessCacheForRepo } = await import('./access');
    await invalidateAllAccessCacheForRepo(42);

    expect(deleteCacheByPattern).toHaveBeenCalledWith('github-access:*:42');
  });
});

describe('invalidateGitHubAccessCache', () => {
  it('deletes only the specific user+repo cache entry when a repositoryId is given', async () => {
    const { deleteCache, deleteCacheByPattern } = await import('../redis');
    vi.mocked(deleteCache).mockReset().mockResolvedValue(true);
    vi.mocked(deleteCacheByPattern).mockReset().mockResolvedValue(0);

    const { invalidateGitHubAccessCache } = await import('./access');
    await invalidateGitHubAccessCache(7, 42);

    expect(deleteCache).toHaveBeenCalledWith('github-access:7:42');
    expect(deleteCacheByPattern).not.toHaveBeenCalled();
  });

  it('deletes every cached entry for the user when no repositoryId is given', async () => {
    const { deleteCache, deleteCacheByPattern } = await import('../redis');
    vi.mocked(deleteCache).mockReset().mockResolvedValue(true);
    vi.mocked(deleteCacheByPattern).mockReset().mockResolvedValue(0);

    const { invalidateGitHubAccessCache } = await import('./access');
    await invalidateGitHubAccessCache(7);

    expect(deleteCacheByPattern).toHaveBeenCalledWith('github-access:7:*');
    expect(deleteCache).not.toHaveBeenCalled();
  });
});

describe('markGitHubTokenInvalid', () => {
  it('marks the connection invalid', async () => {
    const { db } = await import('../database');
    const setMock = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
    vi.mocked(db.update).mockReturnValue({ set: setMock } as unknown as ReturnType<
      typeof db.update
    >);

    const { markGitHubTokenInvalid } = await import('./access');
    await markGitHubTokenInvalid(1);

    expect(setMock).toHaveBeenCalledWith(expect.objectContaining({ status: 'invalid' }));
  });

  it('logs but does not throw when the update fails', async () => {
    const { db } = await import('../database');
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(db.update).mockImplementation(() => {
      throw new Error('database unavailable');
    });

    const { markGitHubTokenInvalid } = await import('./access');
    await expect(markGitHubTokenInvalid(1)).resolves.toBeUndefined();

    expect(consoleSpy).toHaveBeenCalledWith(
      'Failed to mark GitHub token as invalid:',
      expect.any(Error),
    );
    consoleSpy.mockRestore();
  });
});
