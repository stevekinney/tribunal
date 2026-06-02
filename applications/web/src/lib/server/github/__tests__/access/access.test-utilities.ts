/**
 * Shared test utilities for GitHub access integration tests.
 */
import { vi, type Mock } from 'vitest';
import { db } from '$lib/server/database';
import { getOAuthConnection } from '$lib/server/auth/authentication';
import { getCached, setCache, deleteCache, deleteCacheByPattern } from '$lib/server/redis';

// ============================================================================
// Test Constants
// ============================================================================

/** Frozen timestamp for deterministic time-based tests */
export const FROZEN_TIME = new Date('2025-01-15T12:00:00Z');

/** Default test repository owner */
export const TEST_OWNER = 'test-org';

/** Default test repository name */
export const TEST_REPO = 'test-repo';

/** Default test OAuth token */
export const TEST_TOKEN = 'gho_test_token_12345';

/**
 * Unique ID ranges per test file to avoid module-level state collision.
 * Each test file uses a distinct range for user/repo IDs.
 *
 * The circuit breaker in `verifyWithCircuitBreaker` is keyed by `${userId}:${repoId}`
 * and persists across files. Using unique ID ranges prevents rate-limited responses
 * in one file from opening the circuit for tests in another file.
 */
export const TEST_ID_RANGES = {
  RESPONSE_MAPPING: { USER: 1000, REPO: 1100 },
  RETRY_BEHAVIOR: { USER: 2000, REPO: 2100 },
  CACHE_DECISIONS: { USER: 3000, REPO: 3100 },
  RESILIENCE: { USER: 4000, REPO: 4100 },
  EDGE_CASES: { USER: 5000, REPO: 5100 },
} as const;

// ============================================================================
// Typed Mock References
// ============================================================================

/** Typed reference to the mocked database */
export const mockDb = db as unknown as {
  select: Mock;
  update: Mock;
};

/** Typed reference to the mocked getOAuthConnection */
export const mockGetOAuthConnection = getOAuthConnection as Mock;

/** Typed reference to the mocked getCached */
export const mockGetCached = getCached as Mock;

/** Typed reference to the mocked setCache */
export const mockSetCache = setCache as Mock;

/** Typed reference to the mocked deleteCache */
export const mockDeleteCache = deleteCache as Mock;

/** Typed reference to the mocked deleteCacheByPattern */
export const mockDeleteCacheByPattern = deleteCacheByPattern as Mock;

// ============================================================================
// Fetch Mock Helper
// ============================================================================

/**
 * Create a vi.fn() mock and assign it to global.fetch with proper typing.
 * Bun's fetch type includes a `preconnect` static method; adding a no-op
 * satisfies the type checker without affecting test behavior.
 */
export function mockGlobalFetch(): ReturnType<typeof vi.fn> {
  const mock = Object.assign(vi.fn(), { preconnect: () => {} });
  global.fetch = mock as unknown as typeof fetch;
  return mock;
}

// ============================================================================
// Default Mock Setup
// ============================================================================

/**
 * Configure default mock behavior for beforeEach.
 * Sets up typical happy-path state.
 */
export function setupDefaultMocks(options?: {
  repoId?: number;
  owner?: string;
  repo?: string;
  token?: string;
  scope?: string | null;
}): void {
  const {
    repoId,
    owner = TEST_OWNER,
    repo = TEST_REPO,
    token = TEST_TOKEN,
    scope = 'repo, user:email',
  } = options ?? {};

  // Default: no cached result
  mockGetCached.mockResolvedValue(null);
  mockSetCache.mockResolvedValue(undefined);
  mockDeleteCache.mockResolvedValue(undefined);
  mockDeleteCacheByPattern.mockResolvedValue(0);

  // Default: valid OAuth connection with repo scope
  mockGetOAuthConnection.mockResolvedValue({
    accessToken: token,
    scope,
  });

  // Default: repository exists in DB (use provided repoId or a default)
  const effectiveRepoId = repoId ?? TEST_ID_RANGES.RESPONSE_MAPPING.REPO;
  mockDb.select.mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi
          .fn()
          .mockResolvedValue([{ id: effectiveRepoId, owner, name: repo, installationId: null }]),
      }),
    }),
  });

  // Default: update succeeds
  mockDb.update.mockReturnValue({
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    }),
  });
}

/**
 * Setup mock for a specific repo ID (useful for unique ID tests).
 */
export function setupMockDbForRepo(repoId: number, owner = TEST_OWNER, repo = TEST_REPO): void {
  mockDb.select.mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue([{ id: repoId, owner, name: repo, installationId: null }]),
      }),
    }),
  });
}

/**
 * Setup mock DB to return no repository (not found).
 */
export function setupMockDbRepoNotFound(): void {
  mockDb.select.mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue([]),
      }),
    }),
  });
}
