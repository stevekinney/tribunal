import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetOAuthConnection, mockRefreshGitHubTokenIfNeeded, mockParseScopes } = vi.hoisted(
  () => ({
    mockGetOAuthConnection: vi.fn(),
    mockRefreshGitHubTokenIfNeeded: vi.fn(),
    mockParseScopes: vi.fn(),
  }),
);

vi.mock('$lib/server/auth/authentication', () => ({
  getOAuthConnection: mockGetOAuthConnection,
  refreshGitHubTokenIfNeeded: mockRefreshGitHubTokenIfNeeded,
}));

vi.mock('./access', () => ({
  parseScopes: mockParseScopes,
}));

import { getUserOctokit } from './user-oauth';

describe('getUserOctokit', () => {
  beforeEach(() => {
    mockGetOAuthConnection.mockReset();
    mockRefreshGitHubTokenIfNeeded.mockReset();
    mockParseScopes.mockReset().mockReturnValue({ scopes: [], hasRepo: false });
  });

  it('returns no_token when there is no connection and no access token', async () => {
    mockRefreshGitHubTokenIfNeeded.mockResolvedValue(null);
    mockGetOAuthConnection.mockResolvedValue(null);

    const result = await getUserOctokit(1);

    expect(result).toEqual({
      ok: false,
      error: 'no_token',
      message: expect.stringContaining('No GitHub connection found'),
    });
  });

  it('returns token_decrypt_failed when a connection exists but has no access token', async () => {
    mockRefreshGitHubTokenIfNeeded.mockResolvedValue(null);
    mockGetOAuthConnection.mockResolvedValue({ accessToken: null, scope: 'repo' });

    const result = await getUserOctokit(1);

    expect(result).toEqual({
      ok: false,
      error: 'token_decrypt_failed',
      message: expect.stringContaining('Failed to access GitHub token'),
    });
  });

  it('returns token_expired when a connection with a token exists but refresh failed', async () => {
    mockRefreshGitHubTokenIfNeeded.mockResolvedValue(null);
    mockGetOAuthConnection.mockResolvedValue({ accessToken: 'stale-token', scope: 'repo' });

    const result = await getUserOctokit(1);

    expect(result).toEqual({
      ok: false,
      error: 'token_expired',
      message: expect.stringContaining('session has expired'),
    });
  });

  it('returns an authenticated Octokit client and parsed scopes on success', async () => {
    mockRefreshGitHubTokenIfNeeded.mockResolvedValue('fresh-token');
    mockGetOAuthConnection.mockResolvedValue({
      accessToken: 'fresh-token',
      scope: 'repo,read:org',
    });
    mockParseScopes.mockReturnValue({ scopes: ['repo', 'read:org'], hasRepo: true });

    const result = await getUserOctokit(1);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.octokit).toBeDefined();
      expect(result.scopes).toEqual({ scopes: ['repo', 'read:org'], hasRepo: true });
    }
    expect(mockParseScopes).toHaveBeenCalledWith('repo,read:org');
  });
});
