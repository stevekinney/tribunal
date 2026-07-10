/**
 * Unified GitHub API read client with Redis caching.
 *
 * `cachedRead` is the single entry point for all cached GitHub API reads.
 * It handles: cache lookup, eTag conditional requests, fail-open on
 * Redis errors, and structured logging.
 *
 * Two files use direct getCached/setCache for non-API-read caching that
 * does not fit the cachedRead model (access checks, rate-limit state). Each
 * is guarded by an eslint-disable comment and tracked for future migration:
 *
 *   - installations/access.ts — write-then-read access checks
 *   - core/rate-limits.ts — rate-limit state tracking (write-heavy)
 *
 * New direct getCached/setCache usage is blocked by the no-restricted-syntax
 * rule in packages/github/eslint.config.js.
 *
 * `listPullRequests` (pull-requests/service.ts) intentionally bypasses
 * `cachedRead` entirely when called without a `repositoryId` — there is no
 * cache key to use without it. In production there is exactly one caller,
 * and it always passes `repositoryId`; the bypass exists for direct/test
 * call sites that have no repository row to key off of. Any new caller that
 * can supply a `repositoryId` must do so — omitting it silently disables
 * caching and Redis-backed rate/API-budget accounting for that call.
 */

import type { CacheOperations } from '../context.js';
import type { CachePolicy } from './cache-policy.js';
import type { CachedEnvelope, CachedEnvelopeSource } from './cached-envelope.js';

// ============================================================================
// Types
// ============================================================================

/** Result returned by cachedRead, including the value and metadata. */
export interface CachedReadResult<T> {
  /** The fetched/cached value. */
  value: T;
  /** How the value was obtained. */
  source: CachedEnvelopeSource;
}

/**
 * Fetch function signature for cachedRead.
 *
 * When `etag` is provided, the function should include an `If-None-Match`
 * header in the request. If GitHub returns 304, it should return
 * `{ notModified: true }`. Otherwise, it returns the fresh data and
 * optionally the new eTag from the response headers.
 */
export type CachedReadFetchFunction<T> = (etag?: string) => Promise<CachedReadFetchResult<T>>;

export type CachedReadFetchResult<T> =
  | { notModified: true }
  | { notModified?: false; data: T; etag?: string };

/** Options for a single cachedRead call. */
export interface CachedReadOptions {
  /** Skip cache entirely — always call GitHub. Still stores the result. */
  bypass?: boolean;
}

/**
 * Multiplier applied to `policy.ttlSeconds` when setting the Redis key's EX
 * (physical expiration). The envelope's `expiresAt` field controls the logical
 * freshness check inside `cachedRead`. By keeping the Redis key alive longer
 * than the logical TTL, stale-but-eTag-bearing envelopes remain available for
 * conditional requests (If-None-Match / 304) instead of being evicted the
 * instant they become stale.
 *
 * Example: with ttlSeconds=60 and multiplier=2, the envelope is logically
 * stale after 60s but remains in Redis for 120s, giving a 60s window for
 * eTag conditional revalidation.
 */
const STALE_WHILE_REVALIDATE_MULTIPLIER = 2;

/**
 * Internal error to distinguish unexpected 304 responses from other API errors.
 * Prevents double logging in fetchAndStore's catch block.
 */
class UnexpectedNotModifiedError extends Error {
  constructor(operationId: string) {
    super(`[github-cache] Unexpected 304 for ${operationId} without cached eTag`);
    this.name = 'UnexpectedNotModifiedError';
  }
}

// ============================================================================
// Main entry point
// ============================================================================

/**
 * Single entry point for all cached GitHub API reads.
 *
 * Flow:
 * 1. Build cache key from `policy.keyFactory(...keyArgs)`
 * 2. Try Redis: `cache.getCached(cacheKey)`
 * 3. If hit and not expired → return with source: 'cache'
 * 4. If hit with eTag and policy.supportsEtag → conditional request
 * 5. On 304 → refresh timestamps, return with source: 'conditional'
 * 6. On 200 → store new envelope, return with source: 'api'
 * 7. On Redis error → fail-open, call GitHub directly
 * 8. On GitHub error → propagate
 *
 * @param cache - Redis cache operations
 * @param policy - Cache policy for this operation
 * @param fetchFunction - Function that calls the GitHub API
 * @param keyArgs - Arguments passed to policy.keyFactory to build the cache key
 * @param options - Optional overrides (bypass, etc.)
 */
export async function cachedRead<T>(
  cache: CacheOperations,
  policy: CachePolicy,
  fetchFunction: CachedReadFetchFunction<T>,
  keyArgs: unknown[],
  options: CachedReadOptions = {},
): Promise<CachedReadResult<T>> {
  const startTime = Date.now();
  const cacheKey = policy.keyFactory(...keyArgs);

  // Bypass mode: skip cache, call GitHub directly
  if (options.bypass) {
    return fetchAndStore(cache, policy, cacheKey, fetchFunction, startTime);
  }

  // Step 1: Try cache
  // getCached calls JSON.parse internally, so we store envelope objects directly
  // (via setCache, which calls JSON.stringify). The result is always a parsed object.
  let envelope: CachedEnvelope<T> | null = null;
  try {
    const raw = await cache.getCached<CachedEnvelope<T>>(cacheKey);
    if (raw !== null && isValidEnvelope(raw)) {
      envelope = raw;
    }
  } catch {
    // Fail-open: Redis error, proceed without cache
    logCacheEvent(policy.operationId, cacheKey, 'redis-error', startTime);
  }

  // Step 2: Cache hit — check expiry
  if (envelope) {
    const now = Date.now();

    if (now < envelope.expiresAt) {
      // Fresh cache hit
      logCacheEvent(policy.operationId, cacheKey, 'hit', startTime);
      return { value: envelope.value, source: 'cache' };
    }

    // Expired but has eTag — try conditional request
    if (envelope.etag && policy.supportsEtag) {
      try {
        const result = await fetchFunction(envelope.etag);

        if (result.notModified) {
          // 304 — refresh timestamps and store updated envelope
          const refreshedEnvelope: CachedEnvelope<T> = {
            ...envelope,
            fetchedAt: now,
            expiresAt: now + policy.ttlSeconds * 1000,
            source: 'conditional',
          };

          await storeEnvelope(cache, cacheKey, refreshedEnvelope, policy);
          logCacheEvent(policy.operationId, cacheKey, 'conditional-304', startTime);
          return { value: envelope.value, source: 'conditional' };
        }

        // 200 — store fresh data
        const freshEnvelope = buildEnvelope(result.data, result.etag, policy.ttlSeconds);
        await storeEnvelope(cache, cacheKey, freshEnvelope, policy);
        logCacheEvent(policy.operationId, cacheKey, 'conditional-200', startTime);
        return { value: result.data, source: 'api' };
      } catch (error) {
        // GitHub error during conditional request — propagate
        logCacheEvent(policy.operationId, cacheKey, 'api-error', startTime);
        throw error;
      }
    }
  }

  // Step 3: Cache miss or expired without eTag — fetch fresh
  return fetchAndStore(cache, policy, cacheKey, fetchFunction, startTime);
}

// ============================================================================
// Internal helpers
// ============================================================================

/** Validate that a value from Redis has the expected envelope shape. */
function isValidEnvelope<T>(value: unknown): value is CachedEnvelope<T> {
  return (
    value !== null &&
    typeof value === 'object' &&
    'value' in value &&
    typeof (value as CachedEnvelope<T>).fetchedAt === 'number' &&
    typeof (value as CachedEnvelope<T>).expiresAt === 'number'
  );
}

async function fetchAndStore<T>(
  cache: CacheOperations,
  policy: CachePolicy,
  cacheKey: string,
  fetchFunction: CachedReadFetchFunction<T>,
  startTime: number,
): Promise<CachedReadResult<T>> {
  try {
    const result = await fetchFunction();

    if (result.notModified) {
      // Unexpected 304 without an eTag — shouldn't happen, but handle gracefully.
      // Log once here and throw without re-logging in the catch block.
      logCacheEvent(policy.operationId, cacheKey, 'unexpected-304', startTime);
      throw new UnexpectedNotModifiedError(policy.operationId);
    }

    const envelope = buildEnvelope(result.data, result.etag, policy.ttlSeconds);
    await storeEnvelope(cache, cacheKey, envelope, policy);
    logCacheEvent(policy.operationId, cacheKey, 'miss', startTime);
    return { value: result.data, source: 'api' };
  } catch (error) {
    // Skip duplicate logging for unexpected-304 — already logged above
    if (!(error instanceof UnexpectedNotModifiedError)) {
      logCacheEvent(policy.operationId, cacheKey, 'api-error', startTime);
    }
    throw error;
  }
}

function buildEnvelope<T>(
  value: T,
  etag: string | undefined,
  ttlSeconds: number,
): CachedEnvelope<T> {
  const now = Date.now();
  return {
    value,
    etag,
    fetchedAt: now,
    expiresAt: now + ttlSeconds * 1000,
    source: 'api',
  };
}

async function storeEnvelope<T>(
  cache: CacheOperations,
  cacheKey: string,
  envelope: CachedEnvelope<T>,
  policy: CachePolicy,
): Promise<void> {
  try {
    // Redis TTL is longer than the envelope's logical TTL so stale entries
    // with eTags survive for conditional revalidation (304 path).
    const redisTtlSeconds = policy.supportsEtag
      ? policy.ttlSeconds * STALE_WHILE_REVALIDATE_MULTIPLIER
      : policy.ttlSeconds;

    // Pass envelope object directly — setCache handles JSON.stringify
    await cache.setCache(cacheKey, envelope, redisTtlSeconds);
  } catch (error) {
    // Fail-open: Redis write error, log and continue
    console.error(`[github-cache] ${policy.operationId} write-error key=${cacheKey}`, error);
  }
}

type CacheEventOutcome =
  | 'hit'
  | 'miss'
  | 'conditional-304'
  | 'conditional-200'
  | 'redis-error'
  | 'api-error'
  | 'unexpected-304';

const ERROR_OUTCOMES = new Set<CacheEventOutcome>(['api-error', 'redis-error', 'unexpected-304']);

function logCacheEvent(
  operationId: string,
  cacheKey: string,
  outcome: CacheEventOutcome,
  startTime: number,
): void {
  const durationMs = Date.now() - startTime;
  const message = `[github-cache] ${operationId} ${outcome} key=${cacheKey} duration=${durationMs}ms`;

  if (ERROR_OUTCOMES.has(outcome)) {
    console.error(message);
  } else if (outcome === 'miss' || outcome === 'conditional-200') {
    console.log(message);
  }
  // 'hit' and 'conditional-304' are not logged — they are the common case
  // and would be too noisy in production. Enable debug logging if needed.
}
