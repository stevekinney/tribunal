import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockPublicEnv = vi.hoisted(() => ({ PUBLIC_NEON_AUTH_URL: undefined as string | undefined }));

vi.mock('$env/dynamic/public', () => ({ env: mockPublicEnv }));

import { getNeonAuthClient } from './neon-client';

describe('getNeonAuthClient', () => {
  beforeEach(() => {
    mockPublicEnv.PUBLIC_NEON_AUTH_URL = undefined;
  });

  it('throws when PUBLIC_NEON_AUTH_URL is not configured', () => {
    expect(() => getNeonAuthClient()).toThrow('PUBLIC_NEON_AUTH_URL is required to use Neon Auth');
  });

  it('creates an auth client when PUBLIC_NEON_AUTH_URL is configured', () => {
    mockPublicEnv.PUBLIC_NEON_AUTH_URL = 'https://auth.example.com';

    const client = getNeonAuthClient();

    expect(client).toBeDefined();
  });
});
