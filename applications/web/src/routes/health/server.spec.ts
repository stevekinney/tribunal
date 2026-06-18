import { describe, expect, it } from 'vitest';
import { createWebHealthResponse } from './health-response';

describe('createWebHealthResponse', () => {
  it('returns 200 when required web dependencies are configured', async () => {
    const response = createWebHealthResponse({
      DATABASE_URL: 'postgres://user:pass@localhost:5432/tribunal',
      REDIS_URL: 'redis://localhost:6379',
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      dependencies: [
        { name: 'database', ok: true },
        { name: 'redis', ok: true },
      ],
    });
  });

  it('returns 503 when a required web dependency is missing', async () => {
    const response = createWebHealthResponse({
      DATABASE_URL: 'postgres://user:pass@localhost:5432/tribunal',
    });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      dependencies: [
        { name: 'database', ok: true },
        { name: 'redis', ok: false, detail: 'REDIS_URL is not configured' },
      ],
    });
  });
});
