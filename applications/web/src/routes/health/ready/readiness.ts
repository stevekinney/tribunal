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
 * Per-caller deadline on a readiness read. A non-Neon Postgres driver sets no
 * query timeout, so a dependency can stall rather than reject (TRI-52). The
 * deadline bounds each caller's wait WITHOUT cancelling or clearing the shared
 * in-flight probe: a stalled probe is left running and coalesced onto, so a burst
 * of polls during an outage issues at most one dangling query rather than one per
 * poll, and callers still get a prompt 503 instead of hanging. The one query
 * clears the cache's in-flight entry when it finally settles, so recovery is
 * detected on the next poll.
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

const readinessCache = createCoalescedCache(probeReadiness, READINESS_CACHE_TTL_MS);

/**
 * Returns the TTL-cached, coalesced readiness result, bounded by a per-caller
 * deadline (TRI-52). The deadline races the shared probe rather than wrapping it,
 * so a caller timing out never clears the in-flight probe — the stalled query
 * keeps running for later callers to coalesce onto instead of each starting a new
 * one.
 */
export function getWebReadiness(): Promise<WebHealthResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<WebHealthResult>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`readiness probe exceeded ${READINESS_PROBE_TIMEOUT_MS}ms`)),
      READINESS_PROBE_TIMEOUT_MS,
    );
    timer.unref?.();
  });
  return Promise.race([readinessCache.get(), deadline]).finally(() => clearTimeout(timer));
}

/** Test-only: clears the readiness cache + in-flight probe between cases. */
export function resetWebReadinessCacheForTests(): void {
  readinessCache.reset();
}
