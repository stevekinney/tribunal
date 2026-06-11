/**
 * Tests for resilience mechanisms: circuit breaker and request deduplication.
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
  TEST_OWNER,
  TEST_REPO,
} from './access.test-utilities';

const originalFetch = global.fetch;

beforeEach(() => {
  vi.clearAllMocks();
  setupDefaultMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  global.fetch = originalFetch;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('Circuit breaker behavior', () => {
  // Use unique IDs from the RESILIENCE range to avoid state collision
  const { USER: baseUserId, REPO: baseRepoId } = TEST_ID_RANGES.RESILIENCE;

  it('opens circuit after 3 consecutive rate_limited responses', async () => {
    const circuitUserId = baseUserId + 1;
    const circuitRepoId = baseRepoId + 1;

    expect.assertions(5);

    // Mock DB to return repo for this unique ID
    setupMockDbForRepo(circuitRepoId, TEST_OWNER, TEST_REPO);

    // Setup: each call returns rate_limited
    let fetchCallCount = 0;
    mockGlobalFetch().mockImplementation(async () => {
      fetchCallCount++;
      // First call is always public check (404)
      if (fetchCallCount % 2 === 1) {
        return { ok: false, status: 404, headers: new Headers() };
      }
      // Authenticated check returns rate limited
      return {
        ok: false,
        status: 429,
        headers: new Headers({ 'Retry-After': '60' }),
      };
    });

    // Make 3 calls to trigger circuit breaker
    for (let i = 0; i < 3; i++) {
      const result = await verifyGitHubRepositoryAccess(circuitUserId, circuitRepoId, {
        skipCache: true,
      });
      expect(result.allowed).toBe(false);
    }

    // Reset fetch call count for next assertion
    fetchCallCount = 0;

    // 4th call should return immediately without hitting GitHub
    const circuitOpenResult = await verifyGitHubRepositoryAccess(circuitUserId, circuitRepoId, {
      skipCache: true,
    });

    expect(circuitOpenResult.allowed).toBe(false);
    // Should NOT have called fetch when circuit is open
    expect(fetchCallCount).toBe(0);
  });

  it('resets circuit on successful response', async () => {
    // Use different unique IDs for this test
    const resetUserId = baseUserId + 2;
    const resetRepoId = baseRepoId + 2;

    expect.assertions(3);

    // Mock DB to return repo for this unique ID
    setupMockDbForRepo(resetRepoId, TEST_OWNER, TEST_REPO);

    let fetchCallCount = 0;
    let shouldSucceed = false;

    mockGlobalFetch().mockImplementation(async () => {
      fetchCallCount++;
      // First call is always public check
      if (fetchCallCount % 2 === 1) {
        if (shouldSucceed) {
          // Public repo success
          return {
            ok: true,
            status: 200,
            headers: new Headers(),
            json: vi.fn().mockResolvedValue({ private: false }),
          };
        }
        return { ok: false, status: 404, headers: new Headers() };
      }
      // Authenticated check
      return {
        ok: false,
        status: 429,
        headers: new Headers({ 'Retry-After': '60' }),
      };
    });

    // Trigger 2 rate limits (not enough to open circuit)
    for (let i = 0; i < 2; i++) {
      await verifyGitHubRepositoryAccess(resetUserId, resetRepoId, { skipCache: true });
    }

    // Now return success to reset circuit
    shouldSucceed = true;
    const successResult = await verifyGitHubRepositoryAccess(resetUserId, resetRepoId, {
      skipCache: true,
    });

    expect(successResult.allowed).toBe(true);

    // Future rate limited response should count from 0 again
    shouldSucceed = false;
    fetchCallCount = 0;

    // This should hit GitHub (circuit was reset)
    const afterResetResult = await verifyGitHubRepositoryAccess(resetUserId, resetRepoId, {
      skipCache: true,
    });

    expect(afterResetResult.allowed).toBe(false);
    // Should have called fetch (circuit not open)
    expect(fetchCallCount).toBeGreaterThan(0);
  });
});

describe('Request deduplication', () => {
  // Use unique IDs from the RESILIENCE range
  const { USER: baseUserId, REPO: baseRepoId } = TEST_ID_RANGES.RESILIENCE;

  it('deduplicates concurrent requests for same user+repo', async () => {
    const dedupUserId = baseUserId + 10;
    const dedupRepoId = baseRepoId + 10;

    expect.assertions(4);

    // Mock DB to return repo for this unique ID
    setupMockDbForRepo(dedupRepoId, TEST_OWNER, TEST_REPO);

    let fetchCallCount = 0;
    // Use a wrapper object to hold the resolver - TypeScript can track mutations better this way
    const deferred: { resolve: (() => void) | null } = { resolve: null };

    // Create a deferred fetch that we can control
    mockGlobalFetch().mockImplementation(async () => {
      fetchCallCount++;
      // Make first fetch slow so we can trigger concurrent calls
      if (fetchCallCount === 1) {
        await new Promise<void>((resolve) => {
          deferred.resolve = resolve;
        });
      }
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        json: vi.fn().mockResolvedValue({ private: false }),
      };
    });

    // Start 3 concurrent requests for same user+repo
    const promise1 = verifyGitHubRepositoryAccess(dedupUserId, dedupRepoId, { skipCache: true });
    const promise2 = verifyGitHubRepositoryAccess(dedupUserId, dedupRepoId, { skipCache: true });
    const promise3 = verifyGitHubRepositoryAccess(dedupUserId, dedupRepoId, { skipCache: true });

    // Allow time for all concurrent requests to register and start waiting
    await new Promise((resolve) => setTimeout(resolve, 10));
    deferred.resolve?.();

    // All should resolve to the same result
    const [result1, result2, result3] = await Promise.all([promise1, promise2, promise3]);

    expect(result1.allowed).toBe(true);
    expect(result2.allowed).toBe(true);
    expect(result3.allowed).toBe(true);

    // Should only have made ONE fetch call (deduplicated)
    // Note: 1 call for public check which succeeds
    expect(fetchCallCount).toBe(1);
  });

  it('makes separate requests for different user+repo combinations', async () => {
    // Use unique IDs for this test
    const userId1 = baseUserId + 20;
    const repoId1 = baseRepoId + 20;
    const userId2 = baseUserId + 21;
    const repoId2 = baseRepoId + 21;

    expect.assertions(3);

    // Mock DB to return repos for these unique IDs (same mock returns same repo structure)
    setupMockDbForRepo(repoId1, TEST_OWNER, TEST_REPO);

    let fetchCallCount = 0;
    mockGlobalFetch().mockImplementation(async () => {
      fetchCallCount++;
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        json: vi.fn().mockResolvedValue({ private: false }),
      };
    });

    // Make concurrent requests for DIFFERENT user+repo combinations
    const [result1, result2] = await Promise.all([
      verifyGitHubRepositoryAccess(userId1, repoId1, { skipCache: true }),
      verifyGitHubRepositoryAccess(userId2, repoId2, { skipCache: true }),
    ]);

    expect(result1.allowed).toBe(true);
    expect(result2.allowed).toBe(true);

    // Should have made 2 fetch calls (one per user+repo combination)
    expect(fetchCallCount).toBe(2);
  });

  it('propagates rejection to all waiters on error', async () => {
    // Use unique IDs for this test
    const errorUserId = baseUserId + 30;
    const errorRepoId = baseRepoId + 30;

    expect.assertions(4);

    // Mock DB to return repo for this unique ID
    setupMockDbForRepo(errorRepoId, TEST_OWNER, TEST_REPO);

    let fetchCallCount = 0;
    // Use a wrapper object to hold the resolver
    const deferred: { resolve: (() => void) | null } = { resolve: null };

    mockGlobalFetch().mockImplementation(async () => {
      fetchCallCount++;
      if (fetchCallCount === 1) {
        await new Promise<void>((resolve) => {
          deferred.resolve = resolve;
        });
        // Return 404 for public check
        return { ok: false, status: 404, headers: new Headers() };
      }
      // Return 401 for authenticated check
      return { ok: false, status: 401, headers: new Headers() };
    });

    // Start concurrent requests
    const promise1 = verifyGitHubRepositoryAccess(errorUserId, errorRepoId, { skipCache: true });
    const promise2 = verifyGitHubRepositoryAccess(errorUserId, errorRepoId, { skipCache: true });

    // Allow time for all concurrent requests to register and start waiting
    await new Promise((resolve) => setTimeout(resolve, 10));
    deferred.resolve?.();

    const [result1, result2] = await Promise.all([promise1, promise2]);

    // Both should get the same error result
    expect(result1.allowed).toBe(false);
    expect(result2.allowed).toBe(false);
    if (!result1.allowed && !result2.allowed) {
      expect(result1.reason).toBe('invalid_token');
      expect(result2.reason).toBe('invalid_token');
    }
  });
});
