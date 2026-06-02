import { describe, it, expect, vi } from 'vitest';
import {
  connectInstallationToUser,
  isInstallationOwnedByUser,
  getInstallationsForUser,
  getUserForInstallation,
} from './user-bindings.js';
import type { GithubServiceContext } from '../context.js';

/**
 * Build a GithubServiceContext whose `db` is a chainable query-builder stub.
 * Each terminal method (the one the function awaits) resolves to `result`.
 */
function createContext(
  result: unknown,
  spies: Partial<{ update: ReturnType<typeof vi.fn>; set: ReturnType<typeof vi.fn> }> = {},
): GithubServiceContext {
  const set = spies.set ?? vi.fn().mockReturnThis();
  const update = spies.update ?? vi.fn().mockReturnValue({ set });

  // A chainable object: every method returns `this`, and the chain is
  // awaitable, resolving to `result` (used for select() pipelines).
  const chain: Record<string, unknown> = {};
  const passthrough = () => chain;
  for (const method of ['select', 'from', 'leftJoin', 'innerJoin', 'where', 'limit']) {
    chain[method] = vi.fn(passthrough);
  }
  // Make the chain awaitable.
  (chain as { then: unknown }).then = (resolve: (value: unknown) => unknown) =>
    Promise.resolve(result).then(resolve);

  // `set` returns an awaitable chain too (for the update path).
  set.mockReturnValue({
    where: vi.fn().mockResolvedValue(undefined),
  });

  const db = {
    update,
    select: chain.select,
  } as unknown as GithubServiceContext['db'];

  return {
    db,
    cache: {
      getCached: vi.fn().mockResolvedValue(null),
      setCache: vi.fn().mockResolvedValue(true),
      setCacheIndefinitely: vi.fn().mockResolvedValue(true),
      deleteCache: vi.fn().mockResolvedValue(true),
      deleteCacheByPattern: vi.fn().mockResolvedValue(0),
      resetCacheClient: vi.fn(),
    },
    getInstallationOctokit: vi.fn().mockResolvedValue(null),
    getGithubApplication: vi.fn().mockReturnValue(null),
  } as unknown as GithubServiceContext;
}

describe('connectInstallationToUser', () => {
  it('updates the installation record with the user id', async () => {
    expect.assertions(2);

    const where = vi.fn().mockResolvedValue(undefined);
    const set = vi.fn().mockReturnValue({ where });
    const update = vi.fn().mockReturnValue({ set });
    const context = createContext(undefined, { update, set });

    const result = await connectInstallationToUser(context, {
      userId: 7,
      installationId: 12345,
    });

    expect(result).toEqual({ success: true });
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ userId: 7 }));
  });
});

describe('isInstallationOwnedByUser', () => {
  it('returns true when a matching row exists', async () => {
    expect.assertions(1);
    const context = createContext([{ id: 1 }]);
    const owned = await isInstallationOwnedByUser(context, 12345, 7);
    expect(owned).toBe(true);
  });

  it('returns false when no matching row exists', async () => {
    expect.assertions(1);
    const context = createContext([]);
    const owned = await isInstallationOwnedByUser(context, 12345, 7);
    expect(owned).toBe(false);
  });
});

describe('getInstallationsForUser', () => {
  it('maps rows to UserInstallation shape with connectedBy', async () => {
    expect.assertions(3);
    const context = createContext([
      {
        id: 1,
        installationId: 12345,
        accountLogin: 'test-org',
        accountType: 'Organization',
        accountAvatarUrl: null,
        repositorySelection: 'all',
        status: 'active',
        statusReason: null,
        lastSyncedAt: null,
        syncStatus: 'idle',
        syncError: null,
        ownerUserId: 7,
        ownerUsername: 'octocat',
        ownerAvatarUrl: 'https://avatar',
      },
    ]);

    const installations = await getInstallationsForUser(context, 7);

    expect(installations).toHaveLength(1);
    expect(installations[0].installationId).toBe(12345);
    expect(installations[0].connectedBy).toEqual({
      id: 7,
      username: 'octocat',
      avatarUrl: 'https://avatar',
    });
  });

  it('returns null connectedBy when owner is missing', async () => {
    expect.assertions(1);
    const context = createContext([
      {
        id: 1,
        installationId: 12345,
        accountLogin: 'test-org',
        accountType: 'Organization',
        accountAvatarUrl: null,
        repositorySelection: 'all',
        status: 'active',
        statusReason: null,
        lastSyncedAt: null,
        syncStatus: 'idle',
        syncError: null,
        ownerUserId: null,
        ownerUsername: null,
        ownerAvatarUrl: null,
      },
    ]);

    const installations = await getInstallationsForUser(context, 7);
    expect(installations[0].connectedBy).toBeNull();
  });
});

describe('getUserForInstallation', () => {
  it('returns the bound user id', async () => {
    expect.assertions(1);
    const context = createContext([{ userId: 7 }]);
    const userId = await getUserForInstallation(context, 12345);
    expect(userId).toBe(7);
  });

  it('returns null when the installation is unbound', async () => {
    expect.assertions(1);
    const context = createContext([{ userId: null }]);
    const userId = await getUserForInstallation(context, 12345);
    expect(userId).toBeNull();
  });

  it('returns null when no installation exists', async () => {
    expect.assertions(1);
    const context = createContext([]);
    const userId = await getUserForInstallation(context, 12345);
    expect(userId).toBeNull();
  });
});
