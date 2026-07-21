import { describe, expect, it, vi } from 'vitest';

const mockEnv = vi.hoisted(() => ({ REDIS_URL: undefined as string | undefined }));

vi.mock('$env/dynamic/private', () => ({ env: mockEnv }));

import { getCached } from './redis';

describe('cache (lazy Redis URL resolver)', () => {
  it('rejects with a descriptive error when REDIS_URL is not configured', async () => {
    await expect(getCached('any-key')).rejects.toThrow('REDIS_URL is not set');
  });
});
