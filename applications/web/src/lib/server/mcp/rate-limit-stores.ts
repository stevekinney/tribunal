import { env } from '$env/dynamic/private';
import {
  createInMemoryConcurrencySlotStore,
  createInMemorySlidingWindowStore,
  createRedisConcurrencySlotStore,
  createRedisSlidingWindowStore,
} from '@lostgradient/mcp/rate-limit';
import type {
  AtomicSlidingWindowStore,
  ConcurrencySlotStore,
  MinimalRedisClient,
} from '@lostgradient/mcp/oauth';
import { getRateLimitClient } from '$lib/server/redis';

/**
 * The MCP rate-limiter's storage (TRI-56). Tribunal supplies only storage and
 * configuration; the limiting — the Lua, the sliding window, the slot identity —
 * lives in `@lostgradient/mcp`. When `REDIS_URL` is set the library's Redis-backed
 * stores run over the one shared client TRI-49 reconciled; without it (local dev)
 * the library's in-memory stores are used so the surface still works. Production
 * requires `REDIS_URL` (the environment schema refuses to boot without it), so the
 * in-memory path is dev-only.
 */

/**
 * A stable `MinimalRedisClient` that forwards each `eval`/`zRem` to the shared
 * client, re-acquiring it per call. This matters for three reasons:
 *
 * - It never pins a dead client. The shared client recreates itself after a
 *   terminal reconnect (see `packages/github/src/cache.ts`), and re-acquiring per
 *   call means the store always talks to the live one rather than a captured,
 *   closed reference (the TRI-49 forward note).
 * - It defers connection to first use, so the stores construct synchronously at
 *   module load without awaiting a connect.
 * - It surfaces a store failure loudly and re-throws. The library propagates a
 *   store error out of the serving layer (verified: `RequestRateLimiter.consume`
 *   has no internal catch and the `/mcp` call site is outside its try), so a Redis
 *   outage fails the request *closed* — never "unlimited". Re-throwing preserves
 *   that; the log makes the cause visible rather than a bare 500.
 *
 * It forwards only `eval`/`zRem` — it is a client adapter, not a reimplementation
 * of any limiting logic.
 */
const rateLimitClientProxy: MinimalRedisClient = {
  eval: async (script, options) => {
    try {
      const client = await getRateLimitClient();
      return await client.eval(script, options);
    } catch (error) {
      console.error('MCP rate-limiter Redis error (failing closed):', error);
      throw error;
    }
  },
  zRem: async (key, member) => {
    try {
      const client = await getRateLimitClient();
      return await client.zRem(key, member);
    } catch (error) {
      console.error('MCP rate-limiter Redis error (failing closed):', error);
      throw error;
    }
  },
};

export type RateLimitStores = {
  slidingWindow: AtomicSlidingWindowStore;
  concurrencySlots: ConcurrencySlotStore;
};

/** True when a real Redis backs the limiter (production always; dev when REDIS_URL is set). */
export function rateLimitingIsRedisBacked(): boolean {
  return Boolean(env.REDIS_URL);
}

/**
 * Builds the rate-limit stores: Redis-backed over the shared client when
 * `REDIS_URL` is set, in-memory otherwise. Refuses in-memory in production as a
 * runtime backstop behind the environment schema's `REDIS_URL` requirement — a
 * host is not one config slip away from silently running unlimited (the library
 * itself does not signal absent stores; see TRI-131).
 */
export function createRateLimitStores(): RateLimitStores {
  if (rateLimitingIsRedisBacked()) {
    return {
      slidingWindow: createRedisSlidingWindowStore(rateLimitClientProxy),
      concurrencySlots: createRedisConcurrencySlotStore(rateLimitClientProxy),
    };
  }

  // Backstop behind the environment schema's production requirement (which is the
  // clean boot gate). Gated on MCP being enabled — that is when the limiter is
  // active and Redis is load-bearing; a production deploy with the surface off
  // needs Redis only for the GitHub cache, which fails open on its own.
  if (env.NODE_ENV === 'production' && env.MCP_ENABLED === 'true') {
    throw new Error(
      'Refusing to serve the MCP surface in production without REDIS_URL: the rate ' +
        'limiter, concurrency cap, and failed-authentication lockout require ' +
        'Redis-backed stores; in-memory stores would run per-process and unbounded.',
    );
  }

  return {
    slidingWindow: createInMemorySlidingWindowStore(),
    concurrencySlots: createInMemoryConcurrencySlotStore(),
  };
}
