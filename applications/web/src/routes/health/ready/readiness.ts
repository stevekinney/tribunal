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
 * Hard ceiling on a single probe. A non-Neon Postgres driver sets no query
 * timeout, so a dependency can stall rather than reject; without this bound the
 * probe would hang forever and every coalesced `/health/ready` request with it
 * (TRI-52). On timeout the probe rejects, which clears the cache's in-flight entry
 * so the next request retries, and the route reports unhealthy.
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

/** Races the probe against a deadline so a stalled dependency cannot hang the endpoint. */
function probeReadinessBounded(): Promise<WebHealthResult> {
  return new Promise<WebHealthResult>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`readiness probe exceeded ${READINESS_PROBE_TIMEOUT_MS}ms`));
    }, READINESS_PROBE_TIMEOUT_MS);
    timer.unref?.();
    probeReadiness().then(
      (result) => {
        clearTimeout(timer);
        resolve(result);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

const readinessCache = createCoalescedCache(probeReadinessBounded, READINESS_CACHE_TTL_MS);

/** Returns the TTL-cached, coalesced readiness result (TRI-52 AC1). */
export function getWebReadiness(): Promise<WebHealthResult> {
  return readinessCache.get();
}

/** Test-only: clears the readiness cache + in-flight probe between cases. */
export function resetWebReadinessCacheForTests(): void {
  readinessCache.reset();
}
