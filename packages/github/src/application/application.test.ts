import { describe, expect, it, vi, beforeEach } from 'vitest';

const { mockGetInstallationOctokit, MockApp } = vi.hoisted(() => {
  const mockGetInstallationOctokit = vi.fn();
  const MockApp = vi.fn().mockImplementation(function (
    this: unknown,
    config: { appId: string; privateKey: string },
  ) {
    return {
      appId: config.appId,
      privateKey: config.privateKey,
      getInstallationOctokit: mockGetInstallationOctokit,
    };
  });
  return { mockGetInstallationOctokit, MockApp };
});

vi.mock('octokit', () => ({
  App: MockApp,
}));

import { createGithubApplication, createGithubApplicationSingleton } from './application.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('createGithubApplication', () => {
  it('constructs an App with the given appId and privateKey', () => {
    expect.assertions(1);
    createGithubApplication('app-123', '-----BEGIN KEY-----\nsome-key\n-----END KEY-----');

    expect(MockApp).toHaveBeenCalledWith({
      appId: 'app-123',
      privateKey: '-----BEGIN KEY-----\nsome-key\n-----END KEY-----',
    });
  });

  it('converts literal \\n sequences in the private key to real newlines', () => {
    expect.assertions(1);
    createGithubApplication('app-123', '-----BEGIN KEY-----\\nsome-key\\n-----END KEY-----');

    expect(MockApp).toHaveBeenCalledWith({
      appId: 'app-123',
      privateKey: '-----BEGIN KEY-----\nsome-key\n-----END KEY-----',
    });
  });

  it('leaves a key with real newlines unchanged', () => {
    expect.assertions(1);
    const key = '-----BEGIN KEY-----\nsome-key\n-----END KEY-----';
    createGithubApplication('app-123', key);

    expect(MockApp).toHaveBeenCalledWith({ appId: 'app-123', privateKey: key });
  });
});

describe('createGithubApplicationSingleton', () => {
  describe('getGithubApplication', () => {
    it('returns null when getConfig returns null', () => {
      expect.assertions(2);
      const { getGithubApplication } = createGithubApplicationSingleton(() => null);

      expect(getGithubApplication()).toBeNull();
      expect(MockApp).not.toHaveBeenCalled();
    });

    it('creates the App on first call and reuses it on subsequent calls', () => {
      expect.assertions(3);
      const getConfig = vi.fn().mockReturnValue({ appId: 'app-123', privateKey: 'private-key' });
      const { getGithubApplication } = createGithubApplicationSingleton(getConfig);

      const first = getGithubApplication();
      const second = getGithubApplication();

      expect(first).not.toBeNull();
      expect(first).toBe(second);
      expect(MockApp).toHaveBeenCalledTimes(1);
    });
  });

  describe('getInstallationOctokit', () => {
    it('returns null when getConfig returns null', async () => {
      expect.assertions(2);
      const { getInstallationOctokit } = createGithubApplicationSingleton(() => null);

      const result = await getInstallationOctokit(42);

      expect(result).toBeNull();
      expect(mockGetInstallationOctokit).not.toHaveBeenCalled();
    });

    it('delegates to the App instance for a configured application', async () => {
      expect.assertions(2);
      const fakeOctokit = { rest: {} };
      mockGetInstallationOctokit.mockResolvedValue(fakeOctokit);
      const getConfig = vi.fn().mockReturnValue({ appId: 'app-123', privateKey: 'private-key' });
      const { getInstallationOctokit } = createGithubApplicationSingleton(getConfig);

      const result = await getInstallationOctokit(42);

      expect(result).toBe(fakeOctokit);
      expect(mockGetInstallationOctokit).toHaveBeenCalledWith(42);
    });
  });

  describe('resetGithubApplication', () => {
    it('forces the next getGithubApplication call to construct a new App', () => {
      expect.assertions(2);
      const getConfig = vi.fn().mockReturnValue({ appId: 'app-123', privateKey: 'private-key' });
      const { getGithubApplication, resetGithubApplication } =
        createGithubApplicationSingleton(getConfig);

      getGithubApplication();
      resetGithubApplication();
      getGithubApplication();

      expect(MockApp).toHaveBeenCalledTimes(2);
      expect(getConfig).toHaveBeenCalledTimes(2);
    });
  });
});
