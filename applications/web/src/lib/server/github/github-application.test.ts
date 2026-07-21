import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockEnv = vi.hoisted(
  () =>
    ({
      GITHUB_APP_ID: undefined,
      GITHUB_APP_PRIVATE_KEY: undefined,
    }) as Record<string, string | undefined>,
);

vi.mock('$env/dynamic/private', () => ({ env: mockEnv }));

import { getGithubApplication, resetGithubApplication } from './github-application';

describe('getGithubApplication', () => {
  beforeEach(() => {
    mockEnv.GITHUB_APP_ID = undefined;
    mockEnv.GITHUB_APP_PRIVATE_KEY = undefined;
    resetGithubApplication();
  });

  it('returns null when the GitHub App is not configured', () => {
    expect(getGithubApplication()).toBeNull();
  });

  it('returns null when only one of the two required variables is set', () => {
    mockEnv.GITHUB_APP_ID = '12345';
    expect(getGithubApplication()).toBeNull();
  });

  it('constructs and caches a single App instance once both variables are set', () => {
    mockEnv.GITHUB_APP_ID = '12345';
    mockEnv.GITHUB_APP_PRIVATE_KEY = 'fake-private-key';

    const first = getGithubApplication();
    const second = getGithubApplication();

    expect(first).not.toBeNull();
    expect(second).toBe(first);
  });
});
