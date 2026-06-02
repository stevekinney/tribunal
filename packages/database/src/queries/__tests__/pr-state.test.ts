import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Database } from '../../connection';
import { getPRState } from '../pr-state';

/**
 * Creates a mock Database object that simulates the drizzle query builder chain.
 *
 * Drizzle chains like `db.select().from().where()` return a PromiseLike that
 * can be awaited directly or have `.limit()` called on it. The mock handles
 * both patterns.
 */
function createMockDatabase(resolvedRows: unknown[] = []) {
  const limitFn = vi.fn().mockResolvedValue(resolvedRows);

  const chain = {
    select: vi.fn(),
    from: vi.fn(),
    where: vi.fn(),
    limit: limitFn,
  };

  // Each method returns the chain so they can be chained together.
  // where() returns a thenable that also has .limit() — matching drizzle behavior.
  chain.select.mockReturnValue(chain);
  chain.from.mockReturnValue(chain);
  chain.where.mockImplementation(() => {
    // Create a thenable that resolves to resolvedRows (for chains without .limit())
    // but also exposes .limit() for chains that need it.
    const thenable = Promise.resolve(resolvedRows);
    Object.assign(thenable, { limit: limitFn });
    return thenable;
  });

  return chain as unknown as Database;
}

describe('pr-state queries', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('getPRState()', () => {
    it('returns null when no matching row is found', async () => {
      const db = createMockDatabase([]);
      const result = await getPRState(db, 100, 42);

      expect(result).toBeNull();
    });

    it('returns the row when a match is found', async () => {
      const mockRow = { id: 1, repositoryId: 100, prNumber: 42, status: 'open' };
      const db = createMockDatabase([mockRow]);

      const result = await getPRState(db, 100, 42);

      expect(result).toEqual(mockRow);
    });

    it('calls limit(1) to restrict results', async () => {
      const db = createMockDatabase([]);
      await getPRState(db, 100, 42);

      expect((db as any).limit).toHaveBeenCalledWith(1);
    });
  });
});
