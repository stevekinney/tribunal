/**
 * Centralized mock setup for GitHub access integration tests.
 * Must be called before any other imports in test files.
 */
import { vi } from 'vitest';

/**
 * Setup all mocks for GitHub access tests.
 * Call this at module level BEFORE importing the module under test.
 *
 * Note: Vitest hoists vi.mock() calls to the top of the file at compile time,
 * so wrapping them in a function still works correctly.
 */
export function setupAccessMocks(): void {
  vi.mock('$env/dynamic/private', () => ({
    env: {
      GITHUB_ACCESS_CACHE_TTL: '300',
      GITHUB_ACCESS_MAX_CONCURRENT: '10',
    },
  }));

  vi.mock('$lib/server/database', () => ({
    db: {
      select: vi.fn(),
      update: vi.fn(),
    },
  }));

  vi.mock('$lib/server/auth/authentication', () => ({
    getOAuthConnection: vi.fn(),
  }));

  vi.mock('$lib/server/redis', () => ({
    getCached: vi.fn(),
    setCache: vi.fn(),
    deleteCache: vi.fn(),
    deleteCacheByPattern: vi.fn(),
  }));
}
