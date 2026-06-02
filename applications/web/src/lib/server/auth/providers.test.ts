import { describe, it, expect } from 'vitest';
import { AUTH_PROVIDERS } from './providers';
import { AUTH_PROVIDER_LIST } from '$lib/constants/authorization-providers';

describe('AUTH_PROVIDERS sync', () => {
  it('should have same providers as shared module', () => {
    const serverProviders = Object.keys(AUTH_PROVIDERS).sort();
    const sharedProviders = [...AUTH_PROVIDER_LIST].sort();
    expect(serverProviders).toEqual(sharedProviders);
  });

  it('should have valid configuration for each provider', () => {
    for (const config of Object.values(AUTH_PROVIDERS)) {
      expect(config.name).toBeTruthy();
      expect(config.icon).toBeTruthy();
      expect(typeof config.client).toBe('function');
    }
  });
});
