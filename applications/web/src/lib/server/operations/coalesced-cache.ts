/**
 * A single-value cache that is TTL-bounded and coalesces concurrent refreshes.
 *
 * While one `load()` is in flight every caller shares that one call, so a burst
 * of readers issues a single underlying operation rather than one each; a value
 * younger than `ttlMs` is returned without calling `load` at all. Used by the
 * cached `/health/ready` probe (TRI-52) so repeated readiness checks do not
 * hammer Postgres/Redis. The `clock` is injectable so TTL expiry is testable
 * deterministically.
 *
 * Every `get` returns an isolated clone of the value — on the cache-hit path AND
 * for each coalesced caller of an in-flight load — so one caller mutating its
 * result cannot corrupt another's (`.claude/rules/caching.md`).
 *
 * With `inFlightTimeoutMs` set, an in-flight load that has not settled within that
 * window is abandoned: awaiting callers reject and the in-flight entry clears, so
 * the next `get` starts a fresh load. This bounds a stalled dependency two ways at
 * once — callers get a prompt rejection instead of hanging, and recovery is
 * detected on the next poll rather than pinning every future caller onto one hung
 * operation — while still coalescing every caller within a single window onto one
 * load (so a poll burst during an outage issues at most one load per window, not
 * one per poll). The underlying `load` is not cancelled (the caller supplies no
 * cancellation), so the abandoned operation runs to completion untracked.
 */
export type CoalescedCache<T> = {
  get(now?: number): Promise<T>;
  reset(): void;
};

export type CoalescedCacheOptions<T> = {
  /** Injectable clock for deterministic TTL tests. Defaults to `Date.now`. */
  clock?: () => number;
  /**
   * Returns an isolated copy of a value. Defaults to `structuredClone`; pass an
   * identity function only for genuinely immutable `T`.
   */
  clone?: (value: T) => T;
  /**
   * Milliseconds after which an unsettled in-flight load is abandoned (awaiting
   * callers reject, the entry clears). Omit for no bound (the entry then clears
   * only when the load settles).
   */
  inFlightTimeoutMs?: number;
};

export function createCoalescedCache<T>(
  load: () => Promise<T>,
  ttlMs: number,
  options: CoalescedCacheOptions<T> = {},
): CoalescedCache<T> {
  const clock = options.clock ?? Date.now;
  const clone = options.clone ?? ((value: T) => structuredClone(value));
  const inFlightTimeoutMs = options.inFlightTimeoutMs;
  let cached: { value: T; expiresAt: number } | null = null;
  let inFlight: Promise<T> | null = null;

  function startLoad(): Promise<T> {
    let expiryTimer: ReturnType<typeof setTimeout> | undefined;
    const loaded = load().then((value) => {
      cached = { value, expiresAt: clock() + ttlMs };
      return value;
    });
    const bounded =
      inFlightTimeoutMs === undefined
        ? loaded
        : Promise.race([
            loaded,
            new Promise<T>((_resolve, reject) => {
              expiryTimer = setTimeout(
                () => reject(new Error('coalesced load deadline exceeded')),
                inFlightTimeoutMs,
              );
              expiryTimer.unref?.();
            }),
          ]);
    const tracked = bounded.finally(() => {
      clearTimeout(expiryTimer);
      if (inFlight === tracked) inFlight = null;
    });
    inFlight = tracked;
    // Each caller attaches its own `.then(clone)` branch that receives the result
    // or rejection; this no-op branch guarantees the shared promise itself is
    // always considered handled, so a rejection observed only through the caller
    // branches never surfaces as an unhandled rejection.
    tracked.catch(() => {});
    return tracked;
  }

  return {
    get(now = clock()) {
      if (cached && now < cached.expiresAt) return Promise.resolve(clone(cached.value));
      // A per-caller `.then(clone)` so each coalesced caller receives its own copy
      // of the shared result rather than a single shared mutable object.
      return (inFlight ?? startLoad()).then(clone);
    },
    reset() {
      cached = null;
      inFlight = null;
    },
  };
}
