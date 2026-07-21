import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  env: {
    DEV_AUTH_GITHUB_TOKEN: undefined as string | undefined,
    DEV_AUTH_GITHUB_TOKEN_FROM_GITHUB_CLI: undefined as string | undefined,
  },
  spawnSync: vi.fn(),
  selectResultQueue: [] as unknown[][],
  insertReturnRows: [] as unknown[],
  updateReturnRows: [] as unknown[],
  fetch: vi.fn(),
  deleteOAuthConnection: vi.fn(),
  upsertOAuthConnection: vi.fn(),
}));

vi.mock('$env/dynamic/private', () => ({ env: mocks.env }));

vi.mock('node:child_process', () => ({ spawnSync: mocks.spawnSync }));

// Chainable stub matching the query-builder shapes dev-github-bypass.ts uses:
// db.select(...).from(...).innerJoin(...).where(...).limit(1) and
// db.select(...).from(...).where(...).limit(1), plus insert/update.
vi.mock('$lib/server/database', () => ({
  db: {
    insert: () => ({
      values: () => ({
        returning: () => mocks.insertReturnRows,
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => ({
          returning: () => mocks.updateReturnRows,
        }),
      }),
    }),
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: () => ({
            limit: () => mocks.selectResultQueue.shift() ?? [],
          }),
        }),
        where: () => ({
          limit: () => mocks.selectResultQueue.shift() ?? [],
        }),
      }),
    }),
  },
}));

vi.mock('./authentication', () => ({
  deleteOAuthConnection: mocks.deleteOAuthConnection,
  upsertOAuthConnection: mocks.upsertOAuthConnection,
}));

import {
  resolveDevGitHubBypassSession,
  resetDevGitHubBypassCacheForTests,
} from './dev-github-bypass';

function gitHubUserResponse(overrides: Partial<Record<string, unknown>> = {}) {
  return new Response(
    JSON.stringify({
      id: 123,
      login: 'stevekinney',
      name: 'Steve Kinney',
      avatar_url: 'https://example.test/avatar.png',
      ...overrides,
    }),
    { status: 200 },
  );
}

describe('resolveDevGitHubBypassSession', () => {
  beforeEach(() => {
    mocks.env.DEV_AUTH_GITHUB_TOKEN = 'configured-token';
    mocks.env.DEV_AUTH_GITHUB_TOKEN_FROM_GITHUB_CLI = undefined;
    mocks.spawnSync.mockReset();
    mocks.selectResultQueue.length = 0;
    mocks.insertReturnRows.length = 0;
    mocks.updateReturnRows.length = 0;
    mocks.fetch.mockReset();
    mocks.deleteOAuthConnection.mockReset();
    mocks.upsertOAuthConnection.mockReset();
    vi.stubGlobal('fetch', mocks.fetch);
    resetDevGitHubBypassCacheForTests();
  });

  it('resolves an existing user from a GitHub OAuth connection before creating one', async () => {
    mocks.fetch
      .mockResolvedValueOnce(gitHubUserResponse())
      .mockResolvedValueOnce(new Response(JSON.stringify({ installations: [] }), { status: 200 }));
    mocks.selectResultQueue.push([
      {
        id: 1,
        username: 'stevekinney',
        name: 'Old Name',
        avatarUrl: null,
        email: null,
        isPlatformAdministrator: false,
      },
    ]);
    mocks.updateReturnRows.push({
      id: 1,
      username: 'stevekinney',
      name: 'Steve Kinney',
      avatarUrl: 'https://example.test/avatar.png',
      email: null,
      isPlatformAdministrator: false,
    });

    const session = await resolveDevGitHubBypassSession();

    expect(session.user).toMatchObject({ id: 1, name: 'Steve Kinney' });
    expect(mocks.insertReturnRows).toEqual([]);
  });

  it('reads the token from the GitHub CLI when configured and succeeds', async () => {
    mocks.env.DEV_AUTH_GITHUB_TOKEN = undefined;
    mocks.env.DEV_AUTH_GITHUB_TOKEN_FROM_GITHUB_CLI = '1';
    mocks.spawnSync.mockReturnValue({ status: 0, stdout: 'cli-token\n' });
    mocks.fetch
      .mockResolvedValueOnce(gitHubUserResponse())
      .mockResolvedValueOnce(new Response(JSON.stringify({ installations: [] }), { status: 200 }));
    mocks.selectResultQueue.push(
      [], // no existing OAuth connection
      [], // no existing installation owner
      [], // no existing dev user
      [], // username available
    );
    mocks.insertReturnRows.push({
      id: 7,
      username: 'stevekinney',
      name: 'Steve Kinney',
      avatarUrl: 'https://example.test/avatar.png',
      email: null,
      isPlatformAdministrator: false,
    });

    const session = await resolveDevGitHubBypassSession();

    expect(mocks.spawnSync).toHaveBeenCalledWith(
      'gh',
      ['auth', 'token', '--hostname', 'github.com'],
      expect.objectContaining({ encoding: 'utf8' }),
    );
    expect(mocks.fetch).toHaveBeenNthCalledWith(
      1,
      'https://api.github.com/user',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer cli-token' }),
      }),
    );
    expect(session.user).toMatchObject({ username: 'stevekinney' });
  });

  it('throws when the GitHub CLI token lookup fails', async () => {
    mocks.env.DEV_AUTH_GITHUB_TOKEN = undefined;
    mocks.env.DEV_AUTH_GITHUB_TOKEN_FROM_GITHUB_CLI = '1';
    mocks.spawnSync.mockReturnValue({ status: 1, stdout: '' });

    await expect(resolveDevGitHubBypassSession()).rejects.toThrow(
      /gh auth token --hostname github.com. failed/,
    );
  });

  it('throws when the GitHub user lookup responds with a non-ok status', async () => {
    mocks.fetch.mockResolvedValueOnce(new Response('forbidden', { status: 403 }));

    await expect(resolveDevGitHubBypassSession()).rejects.toThrow(
      'Dev GitHub auth bypass: GitHub user lookup failed with 403.',
    );
  });

  it('throws when the GitHub user response is missing id or login', async () => {
    mocks.fetch.mockResolvedValueOnce(gitHubUserResponse({ id: 123, login: '' }));

    await expect(resolveDevGitHubBypassSession()).rejects.toThrow(
      'Dev GitHub auth bypass: GitHub user response did not include id and login.',
    );
  });

  it('throws when the GitHub login cannot be used as a Tribunal handle', async () => {
    mocks.fetch.mockResolvedValueOnce(gitHubUserResponse({ login: 'admin' }));

    await expect(resolveDevGitHubBypassSession()).rejects.toThrow(
      /cannot be used as a Tribunal username/,
    );
  });

  it('throws when the derived username already exists and is not linked to this GitHub account', async () => {
    mocks.fetch.mockResolvedValueOnce(gitHubUserResponse());
    mocks.selectResultQueue.push(
      [], // no existing OAuth connection
      [], // no existing installation owner
      [], // no existing dev user
      [{ id: 999 }], // username already taken
    );

    await expect(resolveDevGitHubBypassSession()).rejects.toThrow(
      /already exists and is not linked to this GitHub account/,
    );
  });

  it('throws when creating the local GitHub bypass user does not return a row', async () => {
    mocks.fetch.mockResolvedValueOnce(gitHubUserResponse());
    mocks.selectResultQueue.push(
      [], // no existing OAuth connection
      [], // no existing installation owner
      [], // no existing dev user
      [], // username available
    );
    mocks.insertReturnRows.length = 0;

    await expect(resolveDevGitHubBypassSession()).rejects.toThrow(
      'Dev GitHub auth bypass: failed to create the local GitHub bypass user.',
    );
  });
});
