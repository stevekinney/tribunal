/**
 * A single-value cache that is TTL-bounded and coalesces concurrent refreshes.
 *
 * While one `load()` is in flight every caller shares that one promise, so a
 * burst of readers issues a single underlying call rather than one each; a value
 * younger than `ttlMs` is returned without calling `load` at all. Used by the
 * cached `/health/ready` probe (TRI-52) so repeated readiness checks do not
 * hammer Postgres/Redis. The `clock` is injectable so TTL expiry is testable
 * deterministically.
 */
export type CoalescedCache<T> = {
  get(now?: number): Promise<T>;
  reset(): void;
};

export function createCoalescedCache<T>(
  load: () => Promise<T>,
  ttlMs: number,
  clock: () => number = Date.now,
): CoalescedCache<T> {
  let cached: { value: T; expiresAt: number } | null = null;
  let inFlight: Promise<T> | null = null;

  return {
    get(now = clock()) {
      if (cached && now < cached.expiresAt) return Promise.resolve(cached.value);
      if (inFlight) return inFlight;
      inFlight = load()
        .then((value) => {
          cached = { value, expiresAt: clock() + ttlMs };
          return value;
        })
        .finally(() => {
          inFlight = null;
        });
      return inFlight;
    },
    reset() {
      cached = null;
      inFlight = null;
    },
  };
}
