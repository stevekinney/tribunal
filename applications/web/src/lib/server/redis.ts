import { env } from '$env/dynamic/private';
import { createCache } from '@tribunal/github/cache';

const cache = createCache(() => env.REDIS_URL);

export const {
  getCached,
  setCache,
  setCacheIndefinitely,
  deleteCache,
  deleteCacheByPattern,
  resetCacheClient,
} = cache;
