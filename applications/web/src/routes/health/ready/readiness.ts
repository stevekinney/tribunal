import { env } from '$env/dynamic/private';
import { setCache } from '$lib/server/redis';
import { createCoalescedCache } from '$lib/server/operations/coalesced-cache';
import { probeDatabase } from '../health-database';
import { gatherWebHealth, type WebHealthResult } from '../health-response';

/**
 * How long a readiness probe result is reused before the next probe (TRI-52 AC1).
 * Short enough that `/health/ready` reflects a dependency outage promptly, long
 * enough that frequent operator/automation polls do not each hit Postgres/Redis.
 */
const READINESS_CACHE_TTL_MS = 5_000;

/**
 * Deadline on an in-flight readiness probe (TRI-52). A non-Neon Postgres driver
 * sets no query timeout, so a dependency can stall rather than reject; the cache's
 * `inFlightTimeoutMs` bounds it. Concurrent polls within one window coalesce onto
 * a single probe (so an outage issues at most one probe per window, not one per
 * poll); at the deadline callers reject (the route reports 503) and the entry
 * clears, so the next poll re-probes and can detect recovery. The stalled probe
 * itself cannot be cancelled — probeDatabase exposes no driver-level deadline — so
 * it runs to completion untracked.
 */
const READINESS_PROBE_TIMEOUT_MS = 4_000;

/** Runs the same DB/Redis probes the public `/health` uses (via `gatherWebHealth`). */
function probeReadiness(): Promise<WebHealthResult> {
  return gatherWebHealth(
    { DATABASE_URL: env.DATABASE_URL, REDIS_URL: env.REDIS_URL },
    {
      database: async () => {
        await probeDatabase(env.DATABASE_URL);
      },
      redis: async () => {
        if (!env.REDIS_URL) return;
        const ok = await setCache('__tribunal_health__', 'ok', 10);
        if (!ok) throw new Error('Redis health write failed');
      },
    },
  );
}

const readinessCache = createCoalescedCache(probeReadiness, READINESS_CACHE_TTL_MS, {
  inFlightTimeoutMs: READINESS_PROBE_TIMEOUT_MS,
});

/**
 * Returns the TTL-cached, coalesced readiness result (TRI-52). The cache's
 * in-flight deadline bounds a stalled probe: concurrent polls within one deadline
 * window coalesce onto a single probe (so an outage issues at most one probe per
 * window, not one per poll), callers reject promptly rather than hang, and the
 * entry clears at the deadline so the next poll re-probes and can detect recovery.
 */
export function getWebReadiness(): Promise<WebHealthResult> {
  return readinessCache.get();
}

/** Test-only: clears the readiness cache + in-flight probe between cases. */
export function resetWebReadinessCacheForTests(): void {
  readinessCache.reset();
}
