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

export type CoalescedCacheOptions<T> = {
  /** Injectable clock for deterministic TTL tests. Defaults to `Date.now`. */
  clock?: () => number;
  /**
   * Returns an isolated copy of a value on every `get` — both cache-hit and
   * cache-miss paths — so a caller mutating the result cannot corrupt what the
   * next reader sees (see `.claude/rules/caching.md`). Defaults to
   * `structuredClone`; pass an identity function only for genuinely immutable `T`.
   */
  clone?: (value: T) => T;
};

export function createCoalescedCache<T>(
  load: () => Promise<T>,
  ttlMs: number,
  options: CoalescedCacheOptions<T> = {},
): CoalescedCache<T> {
  const clock = options.clock ?? Date.now;
  const clone = options.clone ?? ((value: T) => structuredClone(value));
  let cached: { value: T; expiresAt: number } | null = null;
  let inFlight: Promise<T> | null = null;

  return {
    get(now = clock()) {
      if (cached && now < cached.expiresAt) return Promise.resolve(clone(cached.value));
      if (inFlight) return inFlight;
      // A rejected load (including a timeout raced by `load` itself) clears
      // `inFlight` via `finally`, so the next call retries rather than every
      // caller coalescing forever onto one hung operation.
      inFlight = load()
        .then((value) => {
          cached = { value, expiresAt: clock() + ttlMs };
          return clone(value);
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
