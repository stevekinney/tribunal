import { describe, expect, it, vi } from 'vitest';
import type { CacheOperations } from '@tribunal/github/context';
import { invalidateUserInstallationsCache } from './user-installations';

function makeCache(): CacheOperations {
  return {
    getCached: vi.fn().mockResolvedValue(null),
    setCache: vi.fn().mockResolvedValue(true),
    setCacheIndefinitely: vi.fn().mockResolvedValue(true),
    deleteCache: vi.fn().mockResolvedValue(true),
    deleteCacheByPattern: vi.fn().mockResolvedValue(0),
    resetCacheClient: vi.fn(),
  } as unknown as CacheOperations;
}

describe('invalidateUserInstallationsCache', () => {
  it("deletes the cached installation list under the user's exact cache key", async () => {
    expect.assertions(2);
    const cache = makeCache();

    await invalidateUserInstallationsCache(cache, 42);

    expect(cache.deleteCache).toHaveBeenCalledWith('github:response:user:42:installations');
    expect(cache.deleteCache).toHaveBeenCalledTimes(1);
  });
});
