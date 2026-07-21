import { beforeEach, describe, expect, it, vi } from 'vitest';

const { privateEnv, publicEnv } = vi.hoisted(() => ({
  privateEnv: {} as Record<string, string | undefined>,
  publicEnv: {} as Record<string, string | undefined>,
}));

vi.mock('$env/dynamic/private', () => ({ env: privateEnv }));
vi.mock('$env/dynamic/public', () => ({ env: publicEnv }));

import { isNeonAuthConfigured } from './neon-auth-configured';

describe('isNeonAuthConfigured', () => {
  beforeEach(() => {
    delete privateEnv.NEON_AUTH_BASE_URL;
    delete publicEnv.PUBLIC_NEON_AUTH_URL;
  });

  it('is false when neither variable is set', () => {
    expect(isNeonAuthConfigured()).toBe(false);
  });

  it('is false when only the public auth URL is set', () => {
    publicEnv.PUBLIC_NEON_AUTH_URL = 'https://auth.example.com';
    expect(isNeonAuthConfigured()).toBe(false);
  });

  it('is false when only the private base URL is set', () => {
    privateEnv.NEON_AUTH_BASE_URL = 'https://auth.internal.example.com';
    expect(isNeonAuthConfigured()).toBe(false);
  });

  it('is true when both variables are set', () => {
    publicEnv.PUBLIC_NEON_AUTH_URL = 'https://auth.example.com';
    privateEnv.NEON_AUTH_BASE_URL = 'https://auth.internal.example.com';
    expect(isNeonAuthConfigured()).toBe(true);
  });
});
