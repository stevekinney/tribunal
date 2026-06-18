import { describe, expect, it } from 'vitest';
import { createHealthResponse } from './health';

describe('createHealthResponse', () => {
  it('returns 200 when proxy dependencies are healthy', async () => {
    const response = createHealthResponse();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      dependencies: [
        { name: 'configuration', ok: true },
        { name: 'credential_resolver', ok: true },
      ],
    });
  });

  it('returns 503 when a dependency is unavailable', async () => {
    const response = createHealthResponse({
      dependencies: [
        { name: 'configuration', ok: true },
        { name: 'credential_resolver', ok: false, detail: 'read token resolver unavailable' },
      ],
    });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      dependencies: [
        { name: 'configuration', ok: true },
        { name: 'credential_resolver', ok: false, detail: 'read token resolver unavailable' },
      ],
    });
  });
});
