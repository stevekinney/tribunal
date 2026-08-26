export type ToolMetricEntry = {
  invocations: number;
  errors: number;
  durations: number[];
};

/**
 * Outcome counters for the OAuth and MCP surfaces a consuming
 * application's own boundary produces — discovery, authorization, token
 * exchange, refresh, revocation, registration, MCP method dispatch,
 * stream disconnects, version negotiation, and conformance failures.
 * Deliberately a flat
 * `category -> outcome -> count` map rather than one field per category:
 * every category has the same shape (a set of named, mutually exclusive
 * outcomes), and this lets a new outcome or category be added at a call
 * site with no change here. `tools` above stays its own typed field
 * because it also carries latency percentiles, which events do not.
 */
export type EventOutcomeCounts = Record<string, Record<string, number>>;

export type MetricsSnapshot = {
  tools: Record<
    string,
    { invocations: number; errors: number; p50: number; p95: number; p99: number }
  >;
  events: EventOutcomeCounts;
  uptimeSeconds: number;
  collectedAt: string;
};

const MAX_DURATIONS = 1000;

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

class MetricsCollector {
  private tools = new Map<string, ToolMetricEntry>();
  private events = new Map<string, Map<string, number>>();
  private startedAt = Date.now();

  recordToolInvocation(name: string, durationMs: number, isError: boolean): void {
    let entry = this.tools.get(name);
    if (!entry) {
      entry = { invocations: 0, errors: 0, durations: [] };
      this.tools.set(name, entry);
    }
    entry.invocations++;
    if (isError) entry.errors++;
    entry.durations.push(durationMs);
    if (entry.durations.length > MAX_DURATIONS) {
      entry.durations = entry.durations.slice(-MAX_DURATIONS);
    }
  }

  /**
   * OBS-001: increments the counter for one `(category, outcome)` pair —
   * e.g. `recordEvent('registration', 'success')`,
   * `recordEvent('token_exchange', 'invalid_client')`,
   * `recordEvent('authorization', 'user_denied')`. Never pass a secret,
   * token, or user-identifying value as `outcome` — this is a metric
   * label, not a log field, and stays in memory for the life of the
   * process.
   */
  recordEvent(category: string, outcome: string): void {
    let outcomes = this.events.get(category);
    if (!outcomes) {
      outcomes = new Map();
      this.events.set(category, outcomes);
    }
    outcomes.set(outcome, (outcomes.get(outcome) ?? 0) + 1);
  }

  /**
   * Review round 4 / P2: this previously cleared `entry.durations` after
   * computing percentiles, on the mistaken assumption that a snapshot is a
   * one-shot read. `/metrics` (`metrics-routes.ts`) is a Prometheus-style
   * scrape endpoint -- polled repeatedly by one or more scrapers -- and a
   * scrape must be idempotent: reading it must never change what the next
   * reader sees. Clearing the samples here meant a second scraper, or the
   * same scraper on its next interval before another tool invocation, saw
   * `p50`/`p95`/`p99` reset to `0` while `invocations`/`errors` kept
   * climbing -- an internally inconsistent snapshot, and one reader
   * silently consuming data before another could see it. The bounded
   * last-`MAX_DURATIONS` window in `recordToolInvocation` already keeps
   * memory bounded, so nothing here needs to clear it -- the window
   * naturally ages out old samples as new ones arrive.
   */
  snapshot(): MetricsSnapshot {
    const tools: MetricsSnapshot['tools'] = {};
    for (const [name, entry] of this.tools) {
      const sorted = [...entry.durations].sort((a, b) => a - b);
      tools[name] = {
        invocations: entry.invocations,
        errors: entry.errors,
        p50: percentile(sorted, 50),
        p95: percentile(sorted, 95),
        p99: percentile(sorted, 99),
      };
    }
    const events: EventOutcomeCounts = {};
    for (const [category, outcomes] of this.events) {
      events[category] = Object.fromEntries(outcomes);
    }
    return {
      tools,
      events,
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
      collectedAt: new Date().toISOString(),
    };
  }

  reset(): void {
    this.tools.clear();
    this.events.clear();
    this.startedAt = Date.now();
  }
}

export const metricsCollector = new MetricsCollector();
