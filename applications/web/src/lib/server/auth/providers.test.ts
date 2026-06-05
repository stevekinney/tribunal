import { beforeEach, describe, it, expect, vi } from 'vitest';
import { AUTH_PROVIDERS, getGithubRedirectUri } from './providers';
import { AUTH_PROVIDER_LIST } from '$lib/constants/authorization-providers';

const mocks = vi.hoisted(() => ({
  env: {
    GITHUB_CLIENT_ID: 'github-client-id',
    GITHUB_CLIENT_SECRET: 'github-client-secret',
    GITHUB_REDIRECT_URI: '',
  },
  dev: { value: true },
}));

vi.mock('$env/dynamic/private', () => ({
  env: mocks.env,
}));

vi.mock('$app/environment', () => ({
  get dev() {
    return mocks.dev.value;
  },
}));

describe('AUTH_PROVIDERS sync', () => {
  beforeEach(() => {
    mocks.env.GITHUB_REDIRECT_URI = '';
    mocks.dev.value = true;
  });

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

  it('uses the localhost GitHub OAuth callback in local development by default', () => {
    expect(getGithubRedirectUri()).toBe('http://localhost:5173/connect/github/account/callback');
  });

  it('uses an explicit GitHub OAuth redirect URI when configured', () => {
    mocks.env.GITHUB_REDIRECT_URI = 'https://tribunal.example.com/connect/github/account/callback';

    expect(getGithubRedirectUri()).toBe(
      'https://tribunal.example.com/connect/github/account/callback',
    );
  });

  it('requires an explicit GitHub OAuth redirect URI outside local development', () => {
    mocks.dev.value = false;

    expect(getGithubRedirectUri()).toBeNull();
  });
});
