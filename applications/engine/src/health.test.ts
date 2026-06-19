import { describe, expect, it } from 'vitest';
import { createHealthResponse } from './health';

describe('createHealthResponse', () => {
  it('returns 200 when the database and singleton lock are healthy', async () => {
    const response = createHealthResponse();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      dependencies: [
        { name: 'weft_database', ok: true },
        { name: 'singleton_lock', ok: true },
      ],
    });
  });

  it('returns 503 when the engine singleton lock is not held', async () => {
    const response = createHealthResponse({
      dependencies: [
        { name: 'weft_database', ok: true },
        { name: 'singleton_lock', ok: false, detail: 'advisory lock not held' },
      ],
    });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      dependencies: [
        { name: 'weft_database', ok: true },
        { name: 'singleton_lock', ok: false, detail: 'advisory lock not held' },
      ],
    });
  });
});
