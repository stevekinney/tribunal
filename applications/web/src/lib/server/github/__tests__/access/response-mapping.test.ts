/**
 * Tests for HTTP status code to GitHubAccessResult mapping.
 * Covers the checkWithUserToken response mapping logic.
 */

// 1. Mocks FIRST (before any other imports)
import './register-access-mocks';

// 2. Vitest
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// 3. Module under test
import { verifyGitHubRepositoryAccess } from '../../access';

// 4. Test utilities
import {
  setupDefaultMocks,
  setupMockDbForRepo,
  mockGlobalFetch,
  TEST_ID_RANGES,
  FROZEN_TIME,
  mockGetOAuthConnection,
  TEST_TOKEN,
  TEST_OWNER,
  TEST_REPO,
} from './access.test-utilities';

const originalFetch = global.fetch;

// Use unique IDs from RESPONSE_MAPPING range to avoid circuit breaker leakage
const { USER: baseUserId, REPO: baseRepoId } = TEST_ID_RANGES.RESPONSE_MAPPING;

beforeEach(() => {
  vi.clearAllMocks();
  setupDefaultMocks({ repoId: baseRepoId });
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  global.fetch = originalFetch;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('checkWithUserToken response mapping', () => {
  it('200 with private:false returns allowed with public visibility', async () => {
    const userId = baseUserId + 1;
    const repoId = baseRepoId + 1;
    setupMockDbForRepo(repoId, TEST_OWNER, TEST_REPO);

    expect.assertions(2);

    const globalFetch = mockGlobalFetch();
    // Bun's fetch type carries a static `preconnect` method; the stub's
    // no-op satisfies the type, exercised here for completeness.
    (globalFetch as unknown as { preconnect: () => void }).preconnect();
    globalFetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: vi.fn().mockResolvedValue({ private: false }),
    });

    const result = await verifyGitHubRepositoryAccess(userId, repoId);

    expect(result.allowed).toBe(true);
    if (result.allowed) {
      expect(result.visibility).toBe('public');
    }
  });

  it('200 with private:true returns allowed with private visibility', async () => {
    const userId = baseUserId + 2;
    const repoId = baseRepoId + 2;
    setupMockDbForRepo(repoId, TEST_OWNER, TEST_REPO);

    expect.assertions(2);

    // First call for public check (returns 404), second for authenticated check
    mockGlobalFetch()
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        headers: new Headers(),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: vi.fn().mockResolvedValue({ private: true }),
      });

    const result = await verifyGitHubRepositoryAccess(userId, repoId);

    expect(result.allowed).toBe(true);
    if (result.allowed) {
      expect(result.visibility).toBe('private');
    }
  });

  it('401 returns invalid_token', async () => {
    const userId = baseUserId + 3;
    const repoId = baseRepoId + 3;
    setupMockDbForRepo(repoId, TEST_OWNER, TEST_REPO);

    expect.assertions(2);

    mockGlobalFetch()
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        headers: new Headers(),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        headers: new Headers(),
      });

    const result = await verifyGitHubRepositoryAccess(userId, repoId);

    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toBe('invalid_token');
    }
  });

  it('429 with Retry-After returns rate_limited with retryAfter', async () => {
    // Use unique IDs to avoid circuit breaker leakage across test files
    const userId = baseUserId + 4;
    const repoId = baseRepoId + 4;
    setupMockDbForRepo(repoId, TEST_OWNER, TEST_REPO);

    expect.assertions(3);

    mockGlobalFetch()
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        headers: new Headers(),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: new Headers({ 'Retry-After': '120' }),
      });

    const result = await verifyGitHubRepositoryAccess(userId, repoId);

    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toBe('rate_limited');
      expect(result.retryAfter).toBe(120);
    }
  });

  it('403 with X-RateLimit-Remaining:0 returns rate_limited', async () => {
    // Use unique IDs to avoid circuit breaker leakage
    const userId = baseUserId + 5;
    const repoId = baseRepoId + 5;
    setupMockDbForRepo(repoId, TEST_OWNER, TEST_REPO);

    expect.assertions(2);

    // Use fake timers for this specific test to make rate limit calculations deterministic
    vi.useFakeTimers({ now: FROZEN_TIME });
    try {
      const resetTimestamp = Math.floor(FROZEN_TIME.getTime() / 1000) + 300;
      mockGlobalFetch()
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
          headers: new Headers(),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 403,
          headers: new Headers({
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': String(resetTimestamp),
          }),
          json: vi.fn().mockResolvedValue({}),
        });

      const result = await verifyGitHubRepositoryAccess(userId, repoId);

      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.reason).toBe('rate_limited');
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it('403 with X-GitHub-SSO returns sso_required with ssoUrl', async () => {
    const userId = baseUserId + 6;
    const repoId = baseRepoId + 6;
    setupMockDbForRepo(repoId, TEST_OWNER, TEST_REPO);

    expect.assertions(4);

    const ssoUrl = 'https://github.com/orgs/acme-corp/sso?authorization_request=abc123';
    mockGlobalFetch()
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        headers: new Headers(),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
        headers: new Headers({
          'X-GitHub-SSO': `required; url=${ssoUrl}`,
        }),
      });

    const result = await verifyGitHubRepositoryAccess(userId, repoId);

    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toBe('sso_required');
      expect(result.ssoUrl).toBe(ssoUrl);
      expect(result.ssoOrgLogin).toBe('acme-corp');
    }
  });

  it('403 with "access blocked" in body returns repository_blocked', async () => {
    const userId = baseUserId + 7;
    const repoId = baseRepoId + 7;
    setupMockDbForRepo(repoId, TEST_OWNER, TEST_REPO);

    expect.assertions(2);

    mockGlobalFetch()
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        headers: new Headers(),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
        headers: new Headers(),
        json: vi.fn().mockResolvedValue({ message: 'Repository access blocked' }),
      });

    const result = await verifyGitHubRepositoryAccess(userId, repoId);

    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toBe('repository_blocked');
    }
  });

  it('403 with "suspended" in body returns account_suspended', async () => {
    const userId = baseUserId + 8;
    const repoId = baseRepoId + 8;
    setupMockDbForRepo(repoId, TEST_OWNER, TEST_REPO);

    expect.assertions(2);

    mockGlobalFetch()
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        headers: new Headers(),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
        headers: new Headers(),
        json: vi.fn().mockResolvedValue({ message: 'Your account has been suspended' }),
      });

    const result = await verifyGitHubRepositoryAccess(userId, repoId);

    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toBe('account_suspended');
    }
  });

  it('403 without special headers returns insufficient_scope', async () => {
    const userId = baseUserId + 9;
    const repoId = baseRepoId + 9;
    setupMockDbForRepo(repoId, TEST_OWNER, TEST_REPO);

    expect.assertions(2);

    mockGlobalFetch()
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        headers: new Headers(),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
        headers: new Headers(),
        json: vi.fn().mockResolvedValue({ message: 'Resource not accessible by integration' }),
      });

    const result = await verifyGitHubRepositoryAccess(userId, repoId);

    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toBe('insufficient_scope');
    }
  });

  it('404 with full repo scope returns no_access', async () => {
    const userId = baseUserId + 10;
    const repoId = baseRepoId + 10;
    setupMockDbForRepo(repoId, TEST_OWNER, TEST_REPO);

    expect.assertions(2);

    mockGlobalFetch()
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        headers: new Headers(),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        headers: new Headers(),
      });

    const result = await verifyGitHubRepositoryAccess(userId, repoId);

    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toBe('no_access');
    }
  });

  it('404 with unknown scope returns insufficient_scope (conservative)', async () => {
    const userId = baseUserId + 11;
    const repoId = baseRepoId + 11;
    setupMockDbForRepo(repoId, TEST_OWNER, TEST_REPO);

    expect.assertions(2);

    // User has no repo scope - we can't be sure it's truly no_access
    mockGetOAuthConnection.mockResolvedValue({
      accessToken: TEST_TOKEN,
      scope: null, // unknown scope
    });

    mockGlobalFetch()
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        headers: new Headers(),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        headers: new Headers(),
      });

    const result = await verifyGitHubRepositoryAccess(userId, repoId);

    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toBe('insufficient_scope');
    }
  });
});

describe('SSO header edge cases', () => {
  it('handles partial-results SSO type', async () => {
    const userId = baseUserId + 20;
    const repoId = baseRepoId + 20;
    setupMockDbForRepo(repoId, TEST_OWNER, TEST_REPO);

    expect.assertions(3);

    const ssoUrl = 'https://github.com/orgs/my-org/sso?authorization_request=xyz';
    mockGlobalFetch()
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        headers: new Headers(),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
        headers: new Headers({
          'X-GitHub-SSO': `partial-results; url=${ssoUrl}`,
        }),
      });

    const result = await verifyGitHubRepositoryAccess(userId, repoId);

    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toBe('sso_required');
      expect(result.ssoUrl).toBe(ssoUrl);
    }
  });

  it('handles SSO on 200 response (partial results)', async () => {
    const userId = baseUserId + 21;
    const repoId = baseRepoId + 21;
    setupMockDbForRepo(repoId, TEST_OWNER, TEST_REPO);

    expect.assertions(3);

    // SSO can appear even on 200 when partial results are returned
    const ssoUrl = 'https://github.com/orgs/partial-org/sso?auth=123';
    mockGlobalFetch()
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        headers: new Headers(),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({
          'X-GitHub-SSO': `partial-results; url=${ssoUrl}`,
        }),
        json: vi.fn().mockResolvedValue({ private: true }),
      });

    const result = await verifyGitHubRepositoryAccess(userId, repoId);

    // SSO header takes precedence
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toBe('sso_required');
      expect(result.ssoUrl).toBe(ssoUrl);
    }
  });

  it('treats an unrecognized non-ok status (e.g. 500) as a transient no_access denial', async () => {
    const userId = baseUserId + 30;
    const repoId = baseRepoId + 30;
    setupMockDbForRepo(repoId, TEST_OWNER, TEST_REPO);

    expect.assertions(2);

    mockGlobalFetch()
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        headers: new Headers(),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        headers: new Headers(),
      });

    const result = await verifyGitHubRepositoryAccess(userId, repoId);

    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.message).toBe('Unable to verify access');
    }
  });

  it('falls through to the authenticated check when the public repo probe throws a network error', async () => {
    const userId = baseUserId + 31;
    const repoId = baseRepoId + 31;
    setupMockDbForRepo(repoId, TEST_OWNER, TEST_REPO);

    expect.assertions(2);

    mockGlobalFetch()
      .mockRejectedValueOnce(new Error('DNS lookup failed'))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: vi.fn().mockResolvedValue({ private: false }),
      });

    const result = await verifyGitHubRepositoryAccess(userId, repoId);

    expect(result.allowed).toBe(true);
    if (result.allowed) {
      expect(result.visibility).toBe('public');
    }
  });

  it('does not retry a non-network, non-gateway error from the authenticated check', async () => {
    const userId = baseUserId + 32;
    const repoId = baseRepoId + 32;
    setupMockDbForRepo(repoId, TEST_OWNER, TEST_REPO);

    expect.assertions(2);

    let callCount = 0;
    mockGlobalFetch().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return { ok: false, status: 404, headers: new Headers() };
      }
      // A plain Error is neither a TypeError (network) nor a GatewayError
      // (502/503/504), so the retry predicate's final `return false` fires
      // and withRetry must not retry it. checkWithUserToken's outer catch
      // turns it into a graceful no_access denial rather than propagating.
      throw new Error('Unexpected non-retriable failure');
    });

    const result = await verifyGitHubRepositoryAccess(userId, repoId);

    expect(result.allowed).toBe(false);
    // Public check (1) + one authenticated attempt, no retry.
    expect(callCount).toBe(2);
  });
});
