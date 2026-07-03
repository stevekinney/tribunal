import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  env: {
    DEV_AUTH_BYPASS: undefined as string | undefined,
    DEV_AUTH_BYPASS_MODE: undefined as string | undefined,
    DEV_AUTH_BYPASS_USER: undefined as string | undefined,
    DEV_AUTH_GITHUB_TOKEN: undefined as string | undefined,
    DEV_AUTH_GITHUB_TOKEN_FROM_GITHUB_CLI: undefined as string | undefined,
    E2E_TEST_MODE: undefined as string | undefined,
  },
  environment: { dev: true, building: false },
  // Row returned by the mocked select after the mocked insert "runs". Tests
  // set this to simulate a fresh insert vs. an existing (possibly non-bypass) row.
  selectedRow: null as { username: string; neonAuthUserId: string } | null,
  selectResultQueue: [] as unknown[][],
  insertReturnRows: [] as unknown[],
  updateReturnRows: [] as unknown[],
  updateSetCalls: [] as unknown[],
  onConflictDoNothing: vi.fn(),
  deleteOAuthConnection: vi.fn(),
  upsertOAuthConnection: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock('$env/dynamic/private', () => ({ env: mocks.env }));

vi.mock('$app/environment', () => ({
  get dev() {
    return mocks.environment.dev;
  },
  get building() {
    return mocks.environment.building;
  },
}));

// Chainable stub matching the query-builder shape resolveBypassUser uses:
// db.insert(...).values(...).onConflictDoNothing()/returning(...) and
// db.select(...).from(...).where(...).limit(1).
vi.mock('$lib/server/database', () => ({
  db: {
    insert: () => ({
      values: () => ({
        onConflictDoNothing: mocks.onConflictDoNothing,
        returning: () => mocks.insertReturnRows,
      }),
    }),
    update: () => ({
      set: (values: unknown) => {
        mocks.updateSetCalls.push(values);
        return {
          where: () => ({
            returning: () => mocks.updateReturnRows,
          }),
        };
      },
    }),
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: () => ({
            limit: () => mocks.selectResultQueue.shift() ?? [],
          }),
        }),
        where: () => ({
          limit: () =>
            mocks.selectResultQueue.shift() ?? (mocks.selectedRow ? [mocks.selectedRow] : []),
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
  assertDevAuthBypassNotInProduction,
  devAuthBypassMode,
  bypassUsername,
  devAuthBypassHandle,
  isDevAuthBypassEnabled,
  resetDevAuthBypassCacheForTests,
} from './dev-bypass';

describe('assertDevAuthBypassNotInProduction', () => {
  it('throws when the flag is armed outside a dev runtime', () => {
    expect(() => assertDevAuthBypassNotInProduction({ dev: false, DEV_AUTH_BYPASS: '1' })).toThrow(
      /Refusing to start/,
    );
  });

  it('allows the flag in a dev runtime', () => {
    expect(() =>
      assertDevAuthBypassNotInProduction({ dev: true, DEV_AUTH_BYPASS: '1' }),
    ).not.toThrow();
  });

  it('allows a non-dev runtime when the flag is unset', () => {
    expect(() =>
      assertDevAuthBypassNotInProduction({ dev: false, DEV_AUTH_BYPASS: undefined }),
    ).not.toThrow();
  });
});

describe('isDevAuthBypassEnabled', () => {
  beforeEach(() => {
    mocks.env.DEV_AUTH_BYPASS = undefined;
    mocks.environment.dev = true;
  });

  it('is enabled only when dev and the flag is set', () => {
    mocks.env.DEV_AUTH_BYPASS = '1';
    expect(isDevAuthBypassEnabled()).toBe(true);
  });

  it('is disabled without the flag', () => {
    expect(isDevAuthBypassEnabled()).toBe(false);
  });

  it('is disabled outside a dev runtime even with the flag', () => {
    mocks.env.DEV_AUTH_BYPASS = '1';
    mocks.environment.dev = false;
    expect(isDevAuthBypassEnabled()).toBe(false);
  });
});

describe('devAuthBypassMode', () => {
  beforeEach(() => {
    mocks.env.DEV_AUTH_BYPASS_MODE = undefined;
  });

  it('defaults to local mode', () => {
    expect(devAuthBypassMode()).toBe('local');
  });

  it('uses GitHub mode when configured', () => {
    mocks.env.DEV_AUTH_BYPASS_MODE = 'github';
    expect(devAuthBypassMode()).toBe('github');
  });
});

describe('bypassUsername', () => {
  beforeEach(() => {
    mocks.env.DEV_AUTH_BYPASS_USER = undefined;
  });

  it('defaults to "dev" when unset', () => {
    expect(bypassUsername()).toBe('dev');
  });

  it('lowercases and uses a configured username', () => {
    mocks.env.DEV_AUTH_BYPASS_USER = 'Alice';
    expect(bypassUsername()).toBe('alice');
  });

  it('falls back to the default for a reserved username', () => {
    mocks.env.DEV_AUTH_BYPASS_USER = 'admin';
    expect(bypassUsername()).toBe('dev');
  });

  it('falls back to the default for a malformed username', () => {
    mocks.env.DEV_AUTH_BYPASS_USER = '-bad-';
    expect(bypassUsername()).toBe('dev');
  });
});

describe('devAuthBypassHandle', () => {
  const resolve = vi.fn(async (event: { locals: Record<string, unknown> }) => event);

  beforeEach(() => {
    mocks.env.DEV_AUTH_BYPASS = '1';
    mocks.env.DEV_AUTH_BYPASS_MODE = undefined;
    mocks.env.DEV_AUTH_BYPASS_USER = undefined;
    mocks.env.DEV_AUTH_GITHUB_TOKEN = undefined;
    mocks.env.DEV_AUTH_GITHUB_TOKEN_FROM_GITHUB_CLI = undefined;
    mocks.env.E2E_TEST_MODE = undefined;
    mocks.environment.dev = true;
    mocks.selectedRow = null;
    mocks.selectResultQueue.length = 0;
    mocks.insertReturnRows.length = 0;
    mocks.updateReturnRows.length = 0;
    mocks.updateSetCalls.length = 0;
    mocks.fetch.mockReset();
    mocks.deleteOAuthConnection.mockReset();
    mocks.upsertOAuthConnection.mockReset();
    vi.stubGlobal('fetch', mocks.fetch);
    resetDevAuthBypassCacheForTests();
    resolve.mockClear();
  });

  it('logs in the bypass user when the resolved row is a genuine bypass user', async () => {
    mocks.selectedRow = { username: 'dev', neonAuthUserId: 'dev-bypass:dev' };
    const event = { locals: {} };

    await devAuthBypassHandle({ event, resolve } as never);

    expect(event.locals).toMatchObject({ user: { username: 'dev' } });
  });

  it('refuses to log in as an existing account that merely shares the bypass username', async () => {
    // A real Neon Auth user happens to hold the "dev" handle.
    mocks.selectedRow = { username: 'dev', neonAuthUserId: 'neon-real-user-id' };
    const event = { locals: {} };

    await expect(devAuthBypassHandle({ event, resolve } as never)).rejects.toThrow(
      /already belongs to a real account/,
    );
  });

  it('is a pass-through when the bypass is not armed', async () => {
    mocks.env.DEV_AUTH_BYPASS = undefined;
    const event = { locals: {} };

    await devAuthBypassHandle({ event, resolve } as never);

    expect(event.locals).toEqual({});
  });

  it('logs in the GitHub bypass user and stores app-authorized tokens', async () => {
    mocks.env.DEV_AUTH_BYPASS_MODE = 'github';
    mocks.env.DEV_AUTH_GITHUB_TOKEN = 'github-token';
    mocks.fetch
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 123,
            login: 'stevekinney',
            name: 'Steve Kinney',
            avatar_url: 'https://example.test/avatar.png',
          }),
          {
            status: 200,
            headers: { 'X-OAuth-Scopes': 'repo,user:email' },
          },
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ installations: [] }), { status: 200 }));
    mocks.selectResultQueue.push(
      [], // no existing OAuth connection for this GitHub user
      [], // no existing installation owner for this GitHub account
      [], // no existing dev GitHub user
      [], // username is available
    );
    mocks.insertReturnRows.push({
      id: 7,
      username: 'stevekinney',
      name: 'Steve Kinney',
      avatarUrl: 'https://example.test/avatar.png',
      email: null,
      isPlatformAdministrator: false,
    });
    const event = { locals: {} };

    await devAuthBypassHandle({ event, resolve } as never);

    expect(mocks.fetch).toHaveBeenCalledWith(
      'https://api.github.com/user',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer github-token' }),
      }),
    );
    expect(mocks.upsertOAuthConnection).toHaveBeenCalledWith(
      7,
      'github',
      expect.objectContaining({
        providerUserId: '123',
        accessToken: 'github-token',
        refreshToken: null,
        expiresAt: null,
        scope: 'repo,user:email',
      }),
    );
    expect(mocks.deleteOAuthConnection).not.toHaveBeenCalled();
    expect(event.locals).toMatchObject({
      user: { username: 'stevekinney' },
      neonSession: { neonAuthUserId: 'dev-github:123' },
    });
  });

  it('logs in but clears the OAuth connection when the token is not app-authorized', async () => {
    mocks.env.DEV_AUTH_BYPASS_MODE = 'github';
    mocks.env.DEV_AUTH_GITHUB_TOKEN = 'github-token';
    mocks.fetch
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 123,
            login: 'stevekinney',
            name: 'Steve Kinney',
            avatar_url: 'https://example.test/avatar.png',
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: 'not app token' }), { status: 403 }),
      );
    mocks.selectResultQueue.push([], [], [], []);
    mocks.insertReturnRows.push({
      id: 7,
      username: 'stevekinney',
      name: 'Steve Kinney',
      avatarUrl: 'https://example.test/avatar.png',
      email: null,
      isPlatformAdministrator: false,
    });
    const event = { locals: {} };

    await devAuthBypassHandle({ event, resolve } as never);

    expect(mocks.upsertOAuthConnection).not.toHaveBeenCalled();
    expect(mocks.deleteOAuthConnection).toHaveBeenCalledWith(7, 'github');
    expect(event.locals).toMatchObject({
      user: { username: 'stevekinney' },
      neonSession: { neonAuthUserId: 'dev-github:123' },
    });
  });

  it('reuses the active installation owner for the GitHub account before creating a dev user', async () => {
    mocks.env.DEV_AUTH_BYPASS_MODE = 'github';
    mocks.env.DEV_AUTH_GITHUB_TOKEN = 'github-token';
    mocks.fetch
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 123,
            login: 'stevekinney',
            name: 'Steve Kinney',
            avatar_url: 'https://example.test/avatar.png',
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: 'not app token' }), { status: 403 }),
      );
    mocks.selectResultQueue.push(
      [], // no existing OAuth connection for this GitHub user
      [
        {
          id: 1,
          username: 'steve-kinney',
          name: 'Existing Steve',
          avatarUrl: null,
          email: 'hello@example.test',
          isPlatformAdministrator: false,
        },
      ],
    );
    mocks.updateReturnRows.push({
      id: 1,
      username: 'steve-kinney',
      name: 'Steve Kinney',
      avatarUrl: 'https://example.test/avatar.png',
      email: 'hello@example.test',
      isPlatformAdministrator: false,
    });
    const event = { locals: {} };

    await devAuthBypassHandle({ event, resolve } as never);

    expect(mocks.insertReturnRows).toEqual([]);
    expect(mocks.updateSetCalls[0]).not.toHaveProperty('neonAuthUserId');
    expect(mocks.deleteOAuthConnection).toHaveBeenCalledWith(1, 'github');
    expect(event.locals).toMatchObject({
      user: { id: 1, username: 'steve-kinney' },
      neonSession: { neonAuthUserId: 'dev-github:123' },
    });
  });

  it('keeps GitHub bypass sessions fresh across requests', async () => {
    mocks.env.DEV_AUTH_BYPASS_MODE = 'github';
    mocks.env.DEV_AUTH_GITHUB_TOKEN = 'github-token';
    mocks.fetch
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 123,
            login: 'stevekinney',
            name: 'First Name',
            avatar_url: 'https://example.test/first.png',
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: 'not app token' }), { status: 403 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 123,
            login: 'stevekinney',
            name: 'Second Name',
            avatar_url: 'https://example.test/second.png',
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: 'not app token' }), { status: 403 }),
      );
    const existingDevUser = {
      id: 7,
      username: 'stevekinney',
      name: 'Cached Name',
      avatarUrl: null,
      email: null,
      isPlatformAdministrator: false,
    };
    mocks.selectResultQueue.push([], [], [existingDevUser], [], [], [existingDevUser]);
    mocks.updateReturnRows.push({
      id: 7,
      username: 'stevekinney',
      name: 'First Name',
      avatarUrl: 'https://example.test/first.png',
      email: null,
      isPlatformAdministrator: false,
    });
    const firstEvent = { locals: {} };
    const secondEvent = { locals: {} };

    await devAuthBypassHandle({ event: firstEvent, resolve } as never);
    mocks.updateReturnRows.length = 0;
    mocks.updateReturnRows.push({
      id: 7,
      username: 'stevekinney',
      name: 'Second Name',
      avatarUrl: 'https://example.test/second.png',
      email: null,
      isPlatformAdministrator: false,
    });
    await devAuthBypassHandle({ event: secondEvent, resolve } as never);

    expect(mocks.fetch).toHaveBeenCalledTimes(4);
    expect(secondEvent.locals).toMatchObject({
      user: { name: 'Second Name', avatarUrl: 'https://example.test/second.png' },
    });
  });

  it('fails loudly in GitHub mode when no token source is configured', async () => {
    mocks.env.DEV_AUTH_BYPASS_MODE = 'github';
    const event = { locals: {} };

    await expect(devAuthBypassHandle({ event, resolve } as never)).rejects.toThrow(
      /DEV_AUTH_GITHUB_TOKEN/,
    );
  });
});
