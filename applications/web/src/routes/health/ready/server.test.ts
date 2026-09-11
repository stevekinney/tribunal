import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockEnv, mockProbeDatabase, mockSetCache } = vi.hoisted(() => ({
  mockEnv: {} as Record<string, string | undefined>,
  mockProbeDatabase: vi.fn(),
  mockSetCache: vi.fn(),
}));

vi.mock('$env/dynamic/private', () => ({ env: mockEnv }));
vi.mock('../health-database', () => ({ probeDatabase: mockProbeDatabase }));
vi.mock('$lib/server/redis', () => ({ setCache: mockSetCache }));

import type { RequestEvent } from '@sveltejs/kit';
import { mcpHealthProbeRateLimit } from '$lib/server/oauth/configuration';
import { GET } from './+server';
import { resetWebReadinessCacheForTests } from './readiness';

const TOKEN = 'operations-token-value';

let clientCounter = 0;
function readyEvent(bearer?: string, clientAddress?: string): RequestEvent {
  clientCounter += 1;
  const address = clientAddress ?? `10.1.0.${clientCounter}`;
  const request = new Request('http://localhost/health/ready', {
    headers: bearer === undefined ? {} : { authorization: `Bearer ${bearer}` },
  });
  return { request, getClientAddress: () => address } as unknown as RequestEvent;
}

describe('GET /health/ready', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetWebReadinessCacheForTests();
    delete mockEnv.DATABASE_URL;
    delete mockEnv.REDIS_URL;
    mockEnv.MCP_OPERATIONS_TOKEN = TOKEN;
    mockProbeDatabase.mockResolvedValue(undefined);
    mockSetCache.mockResolvedValue(true);
  });

  it('fails closed with 503 and no-store when the token is not configured', async () => {
    delete mockEnv.MCP_OPERATIONS_TOKEN;
    const response = await GET(readyEvent(TOKEN));
    expect(response.status).toBe(503);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(mockProbeDatabase).not.toHaveBeenCalled();
  });

  it('rejects a wrong bearer with 401 and no-store, without probing', async () => {
    const response = await GET(readyEvent('wrong'));
    expect(response.status).toBe(401);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(mockProbeDatabase).not.toHaveBeenCalled();
  });

  it('returns readiness detail with a valid bearer and no-store', async () => {
    mockEnv.DATABASE_URL = 'postgres://localhost/tribunal';
    mockEnv.REDIS_URL = 'redis://localhost:6379';
    const response = await GET(readyEvent(TOKEN));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(body.ok).toBe(true);
    expect(body.dependencies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'database', ok: true }),
        expect.objectContaining({ name: 'redis', ok: true }),
      ]),
    );
  });

  it('caches the probe result across calls within the TTL', async () => {
    mockEnv.DATABASE_URL = 'postgres://localhost/tribunal';
    await GET(readyEvent(TOKEN));
    await GET(readyEvent(TOKEN));
    expect(mockProbeDatabase).toHaveBeenCalledTimes(1);
  });

  it('coalesces concurrent probes into a single dependency round trip', async () => {
    mockEnv.DATABASE_URL = 'postgres://localhost/tribunal';
    let resolveProbe: () => void = () => {};
    mockProbeDatabase.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveProbe = resolve;
      }),
    );
    const first = GET(readyEvent(TOKEN));
    const second = GET(readyEvent(TOKEN));
    resolveProbe();
    await Promise.all([first, second]);
    expect(mockProbeDatabase).toHaveBeenCalledTimes(1);
  });

  it('returns 503 when the readiness probe stalls past its deadline (TRI-52)', async () => {
    vi.useFakeTimers();
    try {
      mockEnv.DATABASE_URL = 'postgres://localhost/tribunal';
      // A stalled dependency: the probe never settles.
      mockProbeDatabase.mockReturnValueOnce(new Promise<void>(() => {}));
      const responsePromise = GET(readyEvent(TOKEN));
      await vi.advanceTimersByTimeAsync(4_001);
      const response = await responsePromise;

      expect(response.status).toBe(503);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
    } finally {
      vi.useRealTimers();
    }
  });

  it('coalesces stalled polls onto one probe rather than one query per poll (TRI-52)', async () => {
    vi.useFakeTimers();
    try {
      mockEnv.DATABASE_URL = 'postgres://localhost/tribunal';
      // The dependency stays stalled across both polls.
      mockProbeDatabase.mockReturnValue(new Promise<void>(() => {}));

      const first = GET(readyEvent(TOKEN));
      await vi.advanceTimersByTimeAsync(4_001);
      expect((await first).status).toBe(503);

      const second = GET(readyEvent(TOKEN));
      await vi.advanceTimersByTimeAsync(4_001);
      expect((await second).status).toBe(503);

      // The caller deadlines did not clear the in-flight probe, so the second poll
      // coalesced onto the first's still-running query instead of starting another.
      expect(mockProbeDatabase).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rate-limits on every request before auth, so wrong-bearer guesses are bounded (OPS-002)', async () => {
    const address = '10.9.9.9';
    const budget = mcpHealthProbeRateLimit.maximumRequests;
    // Every request carries a wrong bearer: auth would reject each, but the
    // rate-limiter runs first and consumes budget, so the run is still bounded.
    let sawRateLimit = false;
    for (let index = 0; index < budget + 1; index += 1) {
      const response = await GET(readyEvent('wrong', address));
      if (response.status === 429) {
        sawRateLimit = true;
        expect(response.headers.get('Retry-After')).not.toBeNull();
        expect(response.headers.get('Cache-Control')).toBe('no-store');
        break;
      }
      expect(response.status).toBe(401);
    }
    expect(sawRateLimit).toBe(true);
  });
});
