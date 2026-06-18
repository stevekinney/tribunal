import { describe, expect, it } from 'vitest';
import { createHealthResponse } from './health';

describe('createHealthResponse', () => {
  it('returns 200 with an ok body', async () => {
    const response = createHealthResponse();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });
});
