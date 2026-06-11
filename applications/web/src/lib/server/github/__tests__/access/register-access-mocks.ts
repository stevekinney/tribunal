/**
 * Centralized mock setup for GitHub access integration tests.
 * Import this for its side effects before any modules under test.
 */
import { vi } from 'vitest';

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
