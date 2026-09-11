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
  // The shared Redis client, narrowed to the rate limiter's surface. This is the
  // web process's single client (TRI-49); TRI-56 hands it to the MCP limiter's
  // Redis store factories instead of opening a second connection.
  getRateLimitClient,
} = cache;
