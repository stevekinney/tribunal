import { describe, expect, it, vi } from 'vitest';

const mintSingleRepositoryReadToken = vi.fn();

vi.mock('@tribunal/database', () => ({
  createDatabase: vi.fn(() => ({})),
}));

vi.mock('@tribunal/github/cache', () => ({
  createCache: vi.fn(() => ({})),
}));

vi.mock('@tribunal/github', () => ({
  createGithubApplicationSingleton: vi.fn(() => ({
    getInstallationOctokit: vi.fn(),
    getGithubApplication: vi.fn(),
  })),
}));

vi.mock('@tribunal/github/reviews/read-tokens', () => ({
  mintSingleRepositoryReadToken,
}));

const { createProxyGitHubCredentialResolver, parsePort } = await import('./index');

describe('parsePort', () => {
  it('uses the parsed port when PORT is valid', () => {
    expect(parsePort('4321', 3002)).toBe(4321);
  });

  it('falls back when PORT is invalid', () => {
    expect(parsePort('not-a-port', 3002)).toBe(3002);
    expect(parsePort('70000', 3002)).toBe(3002);
  });

  it('mints scoped GitHub credentials from capability claims', async () => {
    mintSingleRepositoryReadToken.mockResolvedValue({
      token: 'github-read-token',
      expiresAt: '2026-06-17T13:00:00.000Z',
    });
    const resolveCredential = createProxyGitHubCredentialResolver({
      DATABASE_URL: 'postgres://user:pass@localhost:5432/tribunal',
      REDIS_URL: undefined,
      GITHUB_APP_ID: '123',
      GITHUB_APP_PRIVATE_KEY: 'private-key',
      ANTHROPIC_API_KEY: 'anthropic-key',
      TRIBUNAL_PROXY_URL: 'https://proxy.tribunal.test',
      TRIBUNAL_PROXY_CIDR: '10.0.0.10/32',
      PROXY_CA_CERT: 'certificate',
      PROXY_SIGNING_KEY: 'proxy-signing-key',
      GITHUB_EGRESS_ALLOW: ['api.github.com'],
      ANTHROPIC_EGRESS_ALLOW: ['api.anthropic.com'],
    });

    await expect(
      resolveCredential({
        version: 1,
        runId: 'run_1',
        userId: 1,
        repositoryId: 42,
        installationId: 1001,
        repositoryOwner: 'lostgradient',
        repositoryName: 'tribunal',
        permissions: ['github:read'],
        expiresAtEpochSeconds: 1_782_000_000,
      }),
    ).resolves.toBe('github-read-token');
    expect(mintSingleRepositoryReadToken).toHaveBeenCalledWith(expect.any(Object), {
      installationId: 1001,
      repositoryId: 42,
    });
  });
});
