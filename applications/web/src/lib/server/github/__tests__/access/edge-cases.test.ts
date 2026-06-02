/**
 * Tests for pre-fetch edge cases.
 * Covers scenarios where the function returns early before making GitHub API calls.
 */

// 1. Mocks FIRST (before any other imports)
import { setupAccessMocks } from './access.mocks';
setupAccessMocks();

// 2. Vitest
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// 3. Module under test
import { verifyGitHubRepositoryAccess } from '../../access';

// 4. Test utilities
import {
  setupDefaultMocks,
  setupMockDbForRepo,
  setupMockDbRepoNotFound,
  mockGlobalFetch,
  TEST_ID_RANGES,
  TEST_OWNER,
  TEST_REPO,
  mockGetOAuthConnection,
} from './access.test-utilities';

const originalFetch = global.fetch;

// Use unique IDs from EDGE_CASES range to avoid circuit breaker leakage
const { USER: baseUserId, REPO: baseRepoId } = TEST_ID_RANGES.EDGE_CASES;

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

describe('Pre-fetch edge cases', () => {
  it('returns no_token when user has no OAuth connection', async () => {
    const userId = baseUserId + 1;
    const repoId = baseRepoId + 1;
    setupMockDbForRepo(repoId, TEST_OWNER, TEST_REPO);

    expect.assertions(2);

    mockGetOAuthConnection.mockResolvedValue(null);

    const result = await verifyGitHubRepositoryAccess(userId, repoId);

    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toBe('no_token');
    }
  });

  it('returns no_access when repository not found in DB', async () => {
    const userId = baseUserId + 2;
    const repoId = baseRepoId + 2;

    expect.assertions(2);

    setupMockDbRepoNotFound();

    const result = await verifyGitHubRepositoryAccess(userId, repoId);

    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toBe('no_access');
    }
  });

  it('handles public repo access without token', async () => {
    const userId = baseUserId + 3;
    const repoId = baseRepoId + 3;
    setupMockDbForRepo(repoId, TEST_OWNER, TEST_REPO);

    expect.assertions(2);

    // Public repo check succeeds without auth
    mockGlobalFetch().mockResolvedValueOnce({
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
});
