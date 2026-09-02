import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getRepositoriesForUser: vi.fn() }));

vi.mock('$lib/server/repositories', () => ({
  getRepositoriesForUser: mocks.getRepositoriesForUser,
}));

import {
  findAccessibleRepository,
  findAccessibleRepositoriesByName,
  listAccessibleRepositories,
} from './repository-reader';

function accessibleRepository(id: number, name: string) {
  return {
    repository: {
      id,
      owner: 'lost-gradient',
      name,
      defaultBranch: 'main',
      commit: 'abc123',
      installationId: 7001,
    },
    installation: {
      installationId: 7001,
      accountLogin: 'lost-gradient',
      accountAvatarUrl: null,
    },
  };
}

describe('repository reader', () => {
  beforeEach(() => {
    mocks.getRepositoriesForUser.mockReset();
  });

  it('projects the repositories the user can reach', async () => {
    expect.assertions(1);
    mocks.getRepositoriesForUser.mockResolvedValue({
      ok: true,
      repositories: [accessibleRepository(9001, 'tribunal')],
      installations: [],
    });

    const result = await listAccessibleRepositories(7);

    expect(result).toEqual({
      ok: true,
      repositories: [
        {
          id: 9001,
          owner: 'lost-gradient',
          name: 'tribunal',
          defaultBranch: 'main',
          latestCommit: 'abc123',
          installationAccount: 'lost-gradient',
          installationId: 7001,
        },
      ],
    });
  });

  it.each(['no_github_token', 'github_unavailable'])(
    'passes a %s failure through rather than reporting an empty list',
    async (error) => {
      expect.assertions(1);
      mocks.getRepositoriesForUser.mockResolvedValue({ ok: false, error });

      const result = await listAccessibleRepositories(7);

      expect(result).toEqual({ ok: false, error });
    },
  );

  it('resolves one repository from the accessible set', async () => {
    expect.assertions(1);
    mocks.getRepositoriesForUser.mockResolvedValue({
      ok: true,
      repositories: [accessibleRepository(9001, 'tribunal'), accessibleRepository(9002, 'cinder')],
      installations: [],
    });

    const result = await findAccessibleRepository(7, 9002);

    expect(result).toMatchObject({ ok: true, repository: { id: 9002, name: 'cinder' } });
  });

  it('reports a repository outside the accessible set as absent', async () => {
    expect.assertions(2);
    mocks.getRepositoriesForUser.mockResolvedValue({
      ok: true,
      repositories: [accessibleRepository(9001, 'tribunal')],
      installations: [],
    });

    const result = await findAccessibleRepository(7, 111222333);

    expect(result).toEqual({ ok: true, repository: null });
    // The user's own installation set is the only thing consulted; nothing
    // reads the repository row directly, so an unreachable id cannot be
    // confirmed to exist. `recordTokenInvalidation: false` is what keeps these
    // tools' `readOnlyHint: true` honest — the default path writes
    // `oauth_connection.status` when GitHub answers 401.
    expect(mocks.getRepositoriesForUser).toHaveBeenCalledWith(7, {
      recordTokenInvalidation: false,
    });
  });

  it('passes a lookup failure through', async () => {
    expect.assertions(1);
    mocks.getRepositoriesForUser.mockResolvedValue({ ok: false, error: 'github_unavailable' });

    const result = await findAccessibleRepository(7, 9001);

    expect(result).toEqual({ ok: false, error: 'github_unavailable' });
  });

  it('resolves a repository by owner and name, case-insensitively', async () => {
    expect.assertions(1);
    mocks.getRepositoriesForUser.mockResolvedValue({
      ok: true,
      repositories: [accessibleRepository(9001, 'tribunal'), accessibleRepository(9002, 'cinder')],
      installations: [],
    });

    // GitHub treats owner and repository names case-insensitively, and the
    // caller is typing what a person told them.
    const result = await findAccessibleRepositoriesByName(7, 'Lost-Gradient', 'Cinder');

    expect(result).toMatchObject({ ok: true, matches: [{ id: 9002 }] });
  });

  it('reports a name outside the accessible set as absent', async () => {
    expect.assertions(1);
    mocks.getRepositoriesForUser.mockResolvedValue({
      ok: true,
      repositories: [accessibleRepository(9001, 'tribunal')],
      installations: [],
    });

    const result = await findAccessibleRepositoriesByName(7, 'someone-else', 'private-thing');

    expect(result).toEqual({ ok: true, matches: [] });
  });

  it('passes a failure through when resolving by name', async () => {
    expect.assertions(1);
    mocks.getRepositoriesForUser.mockResolvedValue({ ok: false, error: 'no_github_token' });

    const result = await findAccessibleRepositoriesByName(7, 'lost-gradient', 'tribunal');

    expect(result).toEqual({ ok: false, error: 'no_github_token' });
  });

  it.each([
    ['already ordered', ['lost-gradient', 'zzz-org']],
    ['reversed', ['zzz-org', 'lost-gradient']],
  ])(
    'orders by owner before name, whatever order the resolver returned (%s)',
    async (_label, owners) => {
      expect.assertions(1);
      mocks.getRepositoriesForUser.mockResolvedValue({
        ok: true,
        repositories: owners.map((owner, index) => {
          const entry = accessibleRepository(9001 + index, 'tribunal');
          return { ...entry, repository: { ...entry.repository, owner } };
        }),
        installations: [],
      });

      const result = await listAccessibleRepositories(7);

      expect(result).toMatchObject({
        ok: true,
        repositories: [{ owner: 'lost-gradient' }, { owner: 'zzz-org' }],
      });
    },
  );

  it.each([
    ['already ordered', ['agents', 'tribunal']],
    ['reversed', ['tribunal', 'agents']],
  ])('orders by name within an owner (%s)', async (_label, names) => {
    expect.assertions(1);
    mocks.getRepositoriesForUser.mockResolvedValue({
      ok: true,
      repositories: names.map((name, index) => accessibleRepository(9001 + index, name)),
      installations: [],
    });

    const result = await listAccessibleRepositories(7);

    expect(result).toMatchObject({
      ok: true,
      repositories: [{ name: 'agents' }, { name: 'tribunal' }],
    });
  });

  it('orders tied owner and name pairs by repository id', async () => {
    expect.assertions(1);
    mocks.getRepositoriesForUser.mockResolvedValue({
      ok: true,
      // The shared resolver orders by owner then name, which ties here. Offset
      // paging resolves the set again on every call, so tied rows in
      // unspecified database order can swap between calls and make a later
      // page repeat one repository while omitting the other.
      repositories: [
        accessibleRepository(9004, 'tribunal'),
        accessibleRepository(9001, 'tribunal'),
      ],
      installations: [],
    });

    const result = await listAccessibleRepositories(7);

    expect(result).toMatchObject({ ok: true, repositories: [{ id: 9001 }, { id: 9004 }] });
  });

  it('returns every repository a name matches rather than picking one', async () => {
    expect.assertions(1);
    mocks.getRepositoriesForUser.mockResolvedValue({
      ok: true,
      repositories: [
        accessibleRepository(9001, 'tribunal'),
        accessibleRepository(9004, 'tribunal'),
      ],
      installations: [],
    });

    // A name is not an identifier. Returning one match would answer for a
    // repository the caller never chose; the pull request reader refuses
    // instead and asks for an id.
    const result = await findAccessibleRepositoriesByName(7, 'lost-gradient', 'tribunal');

    expect(result).toMatchObject({ ok: true, matches: [{ id: 9001 }, { id: 9004 }] });
  });
});
