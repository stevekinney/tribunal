import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OAuth2Tokens } from 'arctic';

vi.mock('$env/dynamic/private', () => ({
  env: {
    ENCRYPTION_KEY: 'a'.repeat(64),
    E2E_TEST_MODE: '0',
  },
}));

vi.mock('$app/environment', () => ({
  dev: true,
}));

const mockWhere = vi.fn();
const mockOnConflictDoUpdate = vi.fn();
const mockValues = vi.fn(() => ({ onConflictDoUpdate: mockOnConflictDoUpdate }));
const mockInsert = vi.fn(() => ({ values: mockValues }));
const mockSet = vi.fn(() => ({ where: mockWhere }));
const mockUpdate = vi.fn(() => ({ set: mockSet }));
const mockDeleteWhere = vi.fn();
const mockDelete = vi.fn(() => ({ where: mockDeleteWhere }));

vi.mock('$lib/server/database', () => ({
  db: {
    insert: mockInsert,
    update: mockUpdate,
    delete: mockDelete,
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: mockWhere,
      })),
    })),
  },
}));

const { mockEncrypt, mockDecrypt } = vi.hoisted(() => ({
  mockEncrypt: vi.fn((value: string) => `encrypted:${value}`),
  mockDecrypt: vi.fn((value: string) => {
    if (value.startsWith('encrypted:')) return value.slice('encrypted:'.length);
    throw new Error('Invalid encrypted value');
  }),
}));

vi.mock('$lib/server/encryption', () => ({
  encrypt: mockEncrypt,
  decrypt: mockDecrypt,
}));

const {
  consumeOAuthStateCookie,
  createOAuthState,
  getOAuthConnection,
  readAccessTokenExpiresAt,
  sanitizeReturnTo,
  setOAuthStateCookie,
  upsertOAuthConnection,
} = await import('./authentication');

describe('authentication GitHub connection helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWhere.mockResolvedValue([]);
    mockOnConflictDoUpdate.mockResolvedValue(undefined);
    mockDeleteWhere.mockResolvedValue({ rowCount: 1 });
  });

  it('returns null when an OAuth connection does not exist', async () => {
    await expect(getOAuthConnection(1, 'github')).resolves.toBeNull();
    expect.assertions(1);
  });

  it('decrypts active OAuth connection tokens', async () => {
    mockWhere.mockResolvedValueOnce([
      {
        id: 1,
        userId: 1,
        provider: 'github',
        providerUserId: '123',
        accessToken: 'encrypted:access-token',
        refreshToken: 'encrypted:refresh-token',
        expiresAt: null,
        scope: 'repo,user:email',
        status: 'active',
      },
    ]);

    const connection = await getOAuthConnection(1, 'github');

    expect(connection?.accessToken).toBe('access-token');
    expect(connection?.refreshToken).toBe('refresh-token');
    expect(mockDecrypt).toHaveBeenCalledTimes(2);
    expect.assertions(3);
  });

  it('rejects invalid and undecryptable OAuth connections', async () => {
    mockWhere.mockResolvedValueOnce([
      {
        id: 1,
        userId: 1,
        provider: 'github',
        providerUserId: '123',
        accessToken: 'encrypted:access-token',
        refreshToken: null,
        status: 'invalid',
      },
    ]);
    await expect(getOAuthConnection(1, 'github')).resolves.toBeNull();

    mockWhere.mockResolvedValueOnce([
      {
        id: 1,
        userId: 1,
        provider: 'github',
        providerUserId: '123',
        accessToken: 'not-encrypted',
        refreshToken: null,
        status: 'active',
      },
    ]);
    await expect(getOAuthConnection(1, 'github')).resolves.toBeNull();
    expect.assertions(2);
  });

  it('encrypts and upserts GitHub OAuth connection tokens', async () => {
    await upsertOAuthConnection(1, 'github', {
      providerUserId: 'github-user-1',
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresAt: null,
      scope: 'repo,user:email',
    });

    expect(mockEncrypt).toHaveBeenCalledWith('access-token');
    expect(mockEncrypt).toHaveBeenCalledWith('refresh-token');
    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 1,
        provider: 'github',
        providerUserId: 'github-user-1',
        accessToken: 'encrypted:access-token',
        refreshToken: 'encrypted:refresh-token',
        scope: 'repo,user:email',
        status: 'active',
      }),
    );
    expect(mockOnConflictDoUpdate).toHaveBeenCalledTimes(1);
    expect.assertions(4);
  });

  it('reads the access token expiry, tolerating non-expiring tokens', async () => {
    // GitHub App user-to-server tokens carry an expiry.
    const expires = new Date('2026-06-30T20:00:00.000Z');
    const expiringToken = { accessTokenExpiresAt: () => expires } as unknown as OAuth2Tokens;
    expect(readAccessTokenExpiresAt(expiringToken)).toBe(expires);

    // Classic OAuth App tokens omit `expires_in`; Arctic throws. Treat as null
    // (a non-expiring token) instead of letting the throw escape the callback.
    const nonExpiringToken = {
      accessTokenExpiresAt: () => {
        throw new Error("Missing or invalid 'expires_in' field");
      },
    } as unknown as OAuth2Tokens;
    expect(readAccessTokenExpiresAt(nonExpiringToken)).toBeNull();

    // An unexpected failure (not the known "no expiry" case) must propagate, not
    // be swallowed into a silently non-expiring token.
    const brokenToken = {
      accessTokenExpiresAt: () => {
        throw new Error('Unexpected token parsing failure');
      },
    } as unknown as OAuth2Tokens;
    expect(() => readAccessTokenExpiresAt(brokenToken)).toThrow('Unexpected token parsing failure');
    expect.assertions(3);
  });

  it('sanitizes unsafe return paths', async () => {
    expect(sanitizeReturnTo('/repositories?filter=open#top')).toBe('/repositories?filter=open#top');
    expect(sanitizeReturnTo('/connect/github/account/callback?code=oauth-code&state=state')).toBe(
      '/connect/github',
    );
    expect(sanitizeReturnTo('https://example.com/repositories')).toBe('/');
    expect(sanitizeReturnTo('//example.com/repositories')).toBe('/');
    expect(sanitizeReturnTo('javascript:alert(1)')).toBe('/');
    expect.assertions(5);
  });

  it('validates and consumes OAuth state cookies', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-04T12:00:00.000Z'));

    const cookieJar = new Map<string, string>();
    const cookies = {
      get: (name: string) => cookieJar.get(name),
      set: (name: string, value: string) => cookieJar.set(name, value),
      delete: (name: string) => cookieJar.delete(name),
    } as unknown as import('@sveltejs/kit').Cookies;

    const state = createOAuthState();
    setOAuthStateCookie(cookies, state, 'github', '/connect/github', 42);

    const consumedState = consumeOAuthStateCookie(cookies, state, 42);

    expect(consumedState).toMatchObject({
      nonce: state,
      provider: 'github',
      intent: 'connect',
      returnTo: '/connect/github',
      userId: 42,
    });
    expect(consumeOAuthStateCookie(cookies, state, 42)).toBeNull();

    vi.useRealTimers();
    expect.assertions(2);
  });
});
