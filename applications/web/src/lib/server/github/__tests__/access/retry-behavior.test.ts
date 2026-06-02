/**
 * Tests for retry behavior on gateway errors.
 * Verifies that transient gateway errors (502, 503, 504) trigger retries,
 * while permanent errors (401, 403, 404, 429) do not.
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
  mockGlobalFetch,
  TEST_ID_RANGES,
  TEST_OWNER,
  TEST_REPO,
} from './access.test-utilities';

const originalFetch = global.fetch;

// Use unique IDs from RETRY_BEHAVIOR range to avoid circuit breaker leakage
const { USER: baseUserId, REPO: baseRepoId } = TEST_ID_RANGES.RETRY_BEHAVIOR;

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

describe('Retry behavior for gateway errors', () => {
  it('retries on 502 and succeeds on second attempt', async () => {
    const userId = baseUserId + 1;
    const repoId = baseRepoId + 1;
    setupMockDbForRepo(repoId, TEST_OWNER, TEST_REPO);

    expect.assertions(3);

    let callCount = 0;
    mockGlobalFetch().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        // First call: public check
        return { ok: false, status: 404, headers: new Headers() };
      } else if (callCount === 2) {
        // Second call: authenticated check - gateway error
        return { ok: false, status: 502, headers: new Headers() };
      } else {
        // Third call: retry - success
        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          json: vi.fn().mockResolvedValue({ private: true }),
        };
      }
    });

    const result = await verifyGitHubRepositoryAccess(userId, repoId);

    expect(result.allowed).toBe(true);
    if (result.allowed) {
      expect(result.visibility).toBe('private');
    }
    // Public check (1) + first auth attempt (2) + retry (3) = 3 calls
    expect(callCount).toBe(3);
  });

  it('retries on 503 and returns graceful failure after max attempts', async () => {
    const userId = baseUserId + 2;
    const repoId = baseRepoId + 2;
    setupMockDbForRepo(repoId, TEST_OWNER, TEST_REPO);

    expect.assertions(3);

    let callCount = 0;
    mockGlobalFetch().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        // Public check
        return { ok: false, status: 404, headers: new Headers() };
      }
      // Always return 503 for authenticated calls
      return { ok: false, status: 503, headers: new Headers() };
    });

    const result = await verifyGitHubRepositoryAccess(userId, repoId);

    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toBe('no_access');
    }
    // Public check (1) + first auth (2) + retry (3) = 3 calls (max 2 attempts)
    expect(callCount).toBe(3);
  });

  it('retries on 504 gateway timeout', async () => {
    const userId = baseUserId + 3;
    const repoId = baseRepoId + 3;
    setupMockDbForRepo(repoId, TEST_OWNER, TEST_REPO);

    expect.assertions(2);

    let callCount = 0;
    mockGlobalFetch().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return { ok: false, status: 404, headers: new Headers() };
      } else if (callCount === 2) {
        return { ok: false, status: 504, headers: new Headers() };
      } else {
        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          json: vi.fn().mockResolvedValue({ private: false }),
        };
      }
    });

    const result = await verifyGitHubRepositoryAccess(userId, repoId);

    expect(result.allowed).toBe(true);
    expect(callCount).toBe(3);
  });

  it('retries on network error (TypeError)', async () => {
    const userId = baseUserId + 4;
    const repoId = baseRepoId + 4;
    setupMockDbForRepo(repoId, TEST_OWNER, TEST_REPO);

    expect.assertions(2);

    let callCount = 0;
    mockGlobalFetch().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return { ok: false, status: 404, headers: new Headers() };
      } else if (callCount === 2) {
        throw new TypeError('Failed to fetch');
      } else {
        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          json: vi.fn().mockResolvedValue({ private: true }),
        };
      }
    });

    const result = await verifyGitHubRepositoryAccess(userId, repoId);

    expect(result.allowed).toBe(true);
    expect(callCount).toBe(3);
  });

  it('does NOT retry on 401 - returns immediately', async () => {
    const userId = baseUserId + 5;
    const repoId = baseRepoId + 5;
    setupMockDbForRepo(repoId, TEST_OWNER, TEST_REPO);

    expect.assertions(2);

    let callCount = 0;
    mockGlobalFetch().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return { ok: false, status: 404, headers: new Headers() };
      }
      return { ok: false, status: 401, headers: new Headers() };
    });

    const result = await verifyGitHubRepositoryAccess(userId, repoId);

    expect(result.allowed).toBe(false);
    // Only public check + one authenticated attempt (no retry for 401)
    expect(callCount).toBe(2);
  });

  it('does NOT retry on 403 - returns immediately', async () => {
    const userId = baseUserId + 6;
    const repoId = baseRepoId + 6;
    setupMockDbForRepo(repoId, TEST_OWNER, TEST_REPO);

    expect.assertions(2);

    let callCount = 0;
    mockGlobalFetch().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return { ok: false, status: 404, headers: new Headers() };
      }
      return {
        ok: false,
        status: 403,
        headers: new Headers(),
        json: vi.fn().mockResolvedValue({}),
      };
    });

    const result = await verifyGitHubRepositoryAccess(userId, repoId);

    expect(result.allowed).toBe(false);
    // Only public check + one authenticated attempt (no retry for 403)
    expect(callCount).toBe(2);
  });

  it('does NOT retry on 404 - returns immediately', async () => {
    const userId = baseUserId + 7;
    const repoId = baseRepoId + 7;
    setupMockDbForRepo(repoId, TEST_OWNER, TEST_REPO);

    expect.assertions(2);

    let callCount = 0;
    mockGlobalFetch().mockImplementation(async () => {
      callCount++;
      return { ok: false, status: 404, headers: new Headers() };
    });

    const result = await verifyGitHubRepositoryAccess(userId, repoId);

    expect(result.allowed).toBe(false);
    // Public check + one authenticated attempt (no retry for 404)
    expect(callCount).toBe(2);
  });

  it('does NOT retry on 429 rate limit', async () => {
    const userId = baseUserId + 8;
    const repoId = baseRepoId + 8;
    setupMockDbForRepo(repoId, TEST_OWNER, TEST_REPO);

    expect.assertions(2);

    let callCount = 0;
    mockGlobalFetch().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return { ok: false, status: 404, headers: new Headers() };
      }
      return {
        ok: false,
        status: 429,
        headers: new Headers({ 'Retry-After': '60' }),
      };
    });

    const result = await verifyGitHubRepositoryAccess(userId, repoId);

    expect(result.allowed).toBe(false);
    // Only public check + one authenticated attempt (no retry for 429)
    expect(callCount).toBe(2);
  });
});
