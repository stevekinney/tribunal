import { describe, expect, it } from 'vitest';
import { createWebHealthResponse } from './health-response';

describe('createWebHealthResponse', () => {
  it('returns 200 when required web dependencies are configured', async () => {
    const response = await createWebHealthResponse({
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
    const response = await createWebHealthResponse({
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

  it('returns 503 when the database probe fails', async () => {
    const response = await createWebHealthResponse(
      {
        DATABASE_URL: 'postgres://user:pass@localhost:5432/tribunal',
        REDIS_URL: 'redis://localhost:6379',
      },
      {
        database: async () => {
          throw new Error('connection refused');
        },
      },
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      dependencies: [
        { name: 'database', ok: false, detail: 'connection refused' },
        { name: 'redis', ok: true },
      ],
    });
  });

  it('returns 503 when the Redis probe fails', async () => {
    const response = await createWebHealthResponse(
      {
        DATABASE_URL: 'postgres://user:pass@localhost:5432/tribunal',
        REDIS_URL: 'redis://localhost:6379',
      },
      {
        redis: async () => {
          throw new Error('redis unavailable');
        },
      },
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      dependencies: [
        { name: 'database', ok: true },
        { name: 'redis', ok: false, detail: 'redis unavailable' },
      ],
    });
  });
});
