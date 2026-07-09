/**
 * Request-level GitHub API budget for dashboard fan-out.
 *
 * The dashboard issues up to two live GitHub calls per repository (pull
 * request inventory, default-branch continuous integration) across every
 * repository the user can access. Nothing in this repository previously
 * bounded that fan-out, and secondary GitHub rate limits trip on burstiness
 * rather than raw hourly volume — a dashboard load across dozens of
 * repositories can trip one even while comfortably under the hourly quota.
 *
 * `ApiBudget` is a single-request, in-memory counter (not distributed, not
 * persisted) that:
 *
 * - Caps the total number of live GitHub calls one dashboard build may
 *   attempt, regardless of whether individual calls would have been cache
 *   hits — this keeps the contract simple and deterministic to test.
 * - Trips permanently for the rest of the request the moment GitHub itself
 * 	 reports a rate limit, so a single 403/429 stops further fan-out instead
 *   of hammering the remaining repositories into the same wall.
 *
 * Callers must treat `canSpend(...) === false` as "do not call GitHub for
 * this signal" and fall back to stored decoration or an honest `unknown`
 * value — never a guessed one.
 */

/** Default cap on live GitHub calls per dashboard build. */
export const DEFAULT_DASHBOARD_API_BUDGET = 200;

export type ApiBudgetExhaustedReason = 'budget' | 'rate-limit' | null;

export interface ApiBudgetSnapshot {
  /** True once no further GitHub calls should be attempted this request. */
  exhausted: boolean;
  /** Why the budget stopped granting calls, if it has. */
  exhaustedReason: ApiBudgetExhaustedReason;
  /** Calls remaining before the raw budget cap is hit. */
  remaining: number;
}

export class ApiBudget {
  private remaining: number;
  private rateLimited = false;

  constructor(maxCalls: number = DEFAULT_DASHBOARD_API_BUDGET) {
    if (!Number.isInteger(maxCalls) || maxCalls < 0) {
      throw new Error(`ApiBudget maxCalls must be a non-negative integer, got ${maxCalls}`);
    }
    this.remaining = maxCalls;
  }

  /** Whether a call of the given cost may still be attempted. */
  canSpend(cost = 1): boolean {
    if (!Number.isInteger(cost) || cost < 1) {
      throw new Error(`ApiBudget cost must be a positive integer, got ${cost}`);
    }
    return !this.rateLimited && this.remaining >= cost;
  }

  /** Record a completed (attempted) call against the budget. */
  spend(cost = 1): void {
    if (!Number.isInteger(cost) || cost < 1) {
      throw new Error(`ApiBudget cost must be a positive integer, got ${cost}`);
    }
    this.remaining = Math.max(0, this.remaining - cost);
  }

  /**
   * Trip the breaker: GitHub reported a rate limit. No further calls are
   * granted for the remainder of this dashboard build, regardless of the
   * raw remaining count.
   */
  markRateLimited(): void {
    this.rateLimited = true;
  }

  get snapshot(): ApiBudgetSnapshot {
    const exhausted = this.rateLimited || this.remaining <= 0;
    return {
      exhausted,
      exhaustedReason: this.rateLimited ? 'rate-limit' : this.remaining <= 0 ? 'budget' : null,
      remaining: this.remaining,
    };
  }
}
