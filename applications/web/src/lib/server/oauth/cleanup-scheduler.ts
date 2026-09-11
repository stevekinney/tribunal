import type { OAuthStores } from '@lostgradient/mcp/oauth/stores';

/**
 * `setInterval`'s delay is a 32-bit signed integer of **milliseconds**: a value
 * above 2^31-1 ms overflows and fires almost immediately instead of after the
 * long delay — the failure inverts rather than degrades, turning a rare periodic
 * sweep into a hot loop (TRI-51 AC2). The interval is therefore capped at
 * `floor((2^31-1) / 1000)` seconds so no configured value can overflow it.
 */
export const MAX_SWEEP_INTERVAL_SECONDS = 2_147_483;

/** Default sweep cadence when unset: hourly is frequent enough to bound row growth. */
export const DEFAULT_SWEEP_INTERVAL_SECONDS = 3_600;

const MIN_SWEEP_INTERVAL_SECONDS = 1;

/**
 * Resolves the configured sweep interval to a safe millisecond value, clamping to
 * `[1s, MAX_SWEEP_INTERVAL_SECONDS]` so a too-large value can never overflow
 * `setInterval`'s 32-bit ms argument and fire immediately (AC2), and falling back
 * to the default for an unset, non-finite, or non-positive value.
 */
export function resolveSweepIntervalMs(configuredSeconds: number | undefined): number {
  const seconds =
    configuredSeconds === undefined || !Number.isFinite(configuredSeconds) || configuredSeconds <= 0
      ? DEFAULT_SWEEP_INTERVAL_SECONDS
      : Math.min(
          Math.max(Math.floor(configuredSeconds), MIN_SWEEP_INTERVAL_SECONDS),
          MAX_SWEEP_INTERVAL_SECONDS,
        );
  return seconds * 1000;
}

/**
 * Per-process instance identity, for log correlation and — when Tribunal scales
 * past one web Machine — a future sweep lease. Derived from Fly's allocation
 * identifiers, never Protokit's Railway variables, which Tribunal's runtime does
 * not set (AC5). Falls back to a fixed label.
 */
export function resolveInstanceId(environment: Record<string, string | undefined>): string {
  return environment.FLY_ALLOC_ID ?? environment.FLY_MACHINE_ID ?? 'unknown-instance';
}

export type OauthCleanupSweep = { stop: () => void };

/**
 * Starts an in-process periodic sweep that purges expired OAuth rows through the
 * library's purge primitives (AC1): authorization transactions, authorization
 * codes, and access + refresh tokens (the token store's `purgeExpired` honors the
 * rotation/replay boundary — a rotated-but-unexpired refresh token is retained so
 * replay detection still fires). `ClientStore` is intentionally untouched: it has
 * no `purgeExpired`, because an expired client *secret* is enforced at
 * authentication rather than by deleting the registration row (TRI-92).
 *
 * In-process on the long-lived web process (AC6): the mount already requires a
 * long-lived process for its per-user handler cache, so the sweep adds no new
 * lifecycle constraint.
 *
 * The next run is scheduled with `setTimeout` only *after* the current run
 * settles, never with a fixed-rate `setInterval` — so a purge that runs longer
 * than the interval (a slow `OAUTH_CLEANUP_INTERVAL_SECONDS`, or a database
 * stall) can never let sweeps overlap and pile unbounded concurrent deletes onto
 * the OAuth pool. `stop()` both clears the pending timer and latches `stopped`,
 * so a sweep already in flight when shutdown begins does not schedule another
 * once it settles. Each timer is `unref`'d so the sweep never keeps the process
 * alive on its own.
 */
export function startOauthCleanupSweep(options: {
  stores: Pick<OAuthStores, 'transactions' | 'codes' | 'tokens'>;
  intervalMs: number;
  now?: () => Date;
  onError?: (error: unknown) => void;
}): OauthCleanupSweep {
  const now = options.now ?? (() => new Date());
  const onError =
    options.onError ?? ((error: unknown) => console.error('[oauth-cleanup] sweep failed:', error));

  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function runSweep(): Promise<void> {
    const when = now();
    try {
      await Promise.all([
        options.stores.transactions.purgeExpired(when),
        options.stores.codes.purgeExpired(when),
        options.stores.tokens.purgeExpired(when),
      ]);
    } catch (error) {
      // A sweep failure (e.g. a transient database error) must not crash the
      // process or stop the loop; log and let the next scheduled run retry.
      onError(error);
    }
  }

  function scheduleNext(): void {
    if (stopped) return;
    timer = setTimeout(tick, options.intervalMs);
    timer.unref?.();
  }

  async function tick(): Promise<void> {
    await runSweep();
    // Re-checked inside scheduleNext after the awaited sweep: a stop() that
    // landed while the sweep was in flight prevents the next run.
    scheduleNext();
  }

  scheduleNext();

  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
