import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockEnv } = vi.hoisted(() => ({
  mockEnv: {} as Record<string, string | undefined>,
}));

vi.mock('$env/dynamic/private', () => ({ env: mockEnv }));

import type { RequestEvent } from '@sveltejs/kit';
import { GET } from './+server';

const TOKEN = 'operations-token-value';

let clientCounter = 0;
function metricsEvent(bearer?: string, clientAddress?: string): RequestEvent {
  clientCounter += 1;
  const address = clientAddress ?? `10.2.0.${clientCounter}`;
  const request = new Request('http://localhost/metrics', {
    headers: bearer === undefined ? {} : { authorization: `Bearer ${bearer}` },
  });
  return { request, getClientAddress: () => address } as unknown as RequestEvent;
}

describe('GET /metrics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnv.MCP_OPERATIONS_TOKEN = TOKEN;
  });

  it('fails closed with 503 and no-store when the token is not configured', async () => {
    delete mockEnv.MCP_OPERATIONS_TOKEN;
    const response = await GET(metricsEvent(TOKEN));
    expect(response.status).toBe(503);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('rejects a wrong bearer with 401 and no-store', async () => {
    const response = await GET(metricsEvent('wrong'));
    expect(response.status).toBe(401);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('serves the metrics snapshot with a valid bearer and no-store', async () => {
    const response = await GET(metricsEvent(TOKEN));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    // The library's MetricsSnapshot shape (OBS-001): outcome counters + tool latencies.
    expect(body).toEqual(
      expect.objectContaining({
        tools: expect.any(Object),
        events: expect.any(Object),
        uptimeSeconds: expect.any(Number),
        collectedAt: expect.any(String),
      }),
    );
  });
});
