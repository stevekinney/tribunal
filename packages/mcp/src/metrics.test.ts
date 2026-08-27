import { beforeEach, describe, expect, it } from 'vitest';
import { metricsCollector } from './metrics';

describe('metricsCollector', () => {
  beforeEach(() => {
    metricsCollector.reset();
  });

  it('records tool invocations and tracks counts', () => {
    metricsCollector.recordToolInvocation('my_tool', 100, false);
    metricsCollector.recordToolInvocation('my_tool', 200, false);
    metricsCollector.recordToolInvocation('my_tool', 300, true);

    const snapshot = metricsCollector.snapshot();
    expect(snapshot.tools.my_tool.invocations).toBe(3);
    expect(snapshot.tools.my_tool.errors).toBe(1);
  });

  it('computes percentiles from recorded durations', () => {
    for (let i = 1; i <= 100; i++) {
      metricsCollector.recordToolInvocation('perf_tool', i, false);
    }

    const snapshot = metricsCollector.snapshot();
    expect(snapshot.tools.perf_tool.p50).toBe(50);
    expect(snapshot.tools.perf_tool.p95).toBe(95);
    expect(snapshot.tools.perf_tool.p99).toBe(99);
  });

  it('preserves latency samples across repeated snapshots (a scrape must not destroy data for the next reader)', () => {
    metricsCollector.recordToolInvocation('clear_test', 42, false);
    const first = metricsCollector.snapshot();
    const second = metricsCollector.snapshot();
    expect(first.tools.clear_test.p50).toBe(42);
    expect(second.tools.clear_test.p50).toBe(42);
    expect(second.tools.clear_test.invocations).toBe(1);
  });

  it('keeps the latency window bounded to the most recent MAX_DURATIONS samples without a read clearing it', () => {
    for (let i = 1; i <= 1005; i++) {
      metricsCollector.recordToolInvocation('bounded_tool', i, false);
    }
    const first = metricsCollector.snapshot();
    const second = metricsCollector.snapshot();
    // The oldest 5 samples (1..5) fell out of the 1000-sample window; the
    // window's own p99 is stable across reads because nothing cleared it.
    expect(first.tools.bounded_tool.p99).toBe(second.tools.bounded_tool.p99);
    expect(first.tools.bounded_tool.invocations).toBe(1005);
  });

  it('returns the expected snapshot shape', () => {
    const snapshot = metricsCollector.snapshot();
    expect(snapshot).toHaveProperty('tools');
    expect(snapshot).toHaveProperty('uptimeSeconds');
    expect(snapshot).toHaveProperty('collectedAt');
    expect(typeof snapshot.collectedAt).toBe('string');
  });

  it('records events per (category, outcome) pair and reflects them in the snapshot', () => {
    metricsCollector.recordEvent('mcp_method', 'insufficient_scope');
    metricsCollector.recordEvent('mcp_method', 'insufficient_scope');
    metricsCollector.recordEvent('mcp_method', 'tool_failure');

    const snapshot = metricsCollector.snapshot();
    expect(snapshot.events.mcp_method).toEqual({ insufficient_scope: 2, tool_failure: 1 });
  });

  it('resets all state, including recorded events', () => {
    metricsCollector.recordToolInvocation('reset_test', 10, false);
    metricsCollector.recordEvent('mcp_method', 'tool_failure');
    metricsCollector.reset();

    const snapshot = metricsCollector.snapshot();
    expect(Object.keys(snapshot.tools)).toHaveLength(0);
    expect(Object.keys(snapshot.events)).toHaveLength(0);
  });
});
