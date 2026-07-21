import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockEnv, mockProbeDatabase, mockSetCache } = vi.hoisted(() => ({
  mockEnv: {} as Record<string, string | undefined>,
  mockProbeDatabase: vi.fn(),
  mockSetCache: vi.fn(),
}));

vi.mock('$env/dynamic/private', () => ({ env: mockEnv }));

vi.mock('./health-database', () => ({
  probeDatabase: mockProbeDatabase,
}));

vi.mock('$lib/server/redis', () => ({
  setCache: mockSetCache,
}));

import { GET } from './+server';

describe('GET /health', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete mockEnv.DATABASE_URL;
    delete mockEnv.REDIS_URL;
    mockProbeDatabase.mockResolvedValue(undefined);
    mockSetCache.mockResolvedValue(true);
  });

  it('reports unhealthy dependencies when neither URL is configured', async () => {
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.ok).toBe(false);
    expect(body.dependencies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'database', ok: false }),
        expect.objectContaining({ name: 'redis', ok: false }),
      ]),
    );
  });

  it('probes the database with DATABASE_URL and reports healthy when configured', async () => {
    mockEnv.DATABASE_URL = 'postgres://localhost/tribunal';

    const response = await GET();

    expect(mockProbeDatabase).toHaveBeenCalledWith('postgres://localhost/tribunal');
    const body = await response.json();
    expect(body.dependencies).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'database', ok: true })]),
    );
  });

  it('writes to the cache with REDIS_URL and reports healthy when the write succeeds', async () => {
    mockEnv.REDIS_URL = 'redis://localhost:6379';

    const response = await GET();

    expect(mockSetCache).toHaveBeenCalledWith('__tribunal_health__', 'ok', 10);
    const body = await response.json();
    expect(body.dependencies).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'redis', ok: true })]),
    );
  });

  it('reports redis unhealthy when the cache write fails', async () => {
    mockEnv.REDIS_URL = 'redis://localhost:6379';
    mockSetCache.mockResolvedValue(false);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.dependencies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'redis', ok: false, detail: 'Redis health write failed' }),
      ]),
    );
  });

  it('reports database unhealthy when the probe throws', async () => {
    mockEnv.DATABASE_URL = 'postgres://localhost/tribunal';
    mockProbeDatabase.mockRejectedValue(new Error('connection refused'));

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.dependencies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'database', ok: false, detail: 'connection refused' }),
      ]),
    );
  });

  it('reports ok:true with 200 when both dependencies are healthy', async () => {
    mockEnv.DATABASE_URL = 'postgres://localhost/tribunal';
    mockEnv.REDIS_URL = 'redis://localhost:6379';

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
  });
});
