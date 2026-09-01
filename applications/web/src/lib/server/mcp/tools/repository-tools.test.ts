import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpContext } from '@lostgradient/mcp';
import { readToolResultText } from '../tool-result-text';

const mocks = vi.hoisted(() => ({
  listAccessibleRepositories: vi.fn(),
  findAccessibleRepository: vi.fn(),
}));

vi.mock('../readers/repository-reader', () => ({
  listAccessibleRepositories: mocks.listAccessibleRepositories,
  findAccessibleRepository: mocks.findAccessibleRepository,
}));

import { getRepositoryTool, listRepositoriesTool } from './repository-tools';

const repositoryProjection = {
  id: 9001,
  owner: 'lost-gradient',
  name: 'tribunal',
  defaultBranch: 'main',
  latestCommit: 'abc123',
  installationAccount: 'lost-gradient',
  installationId: 7001,
};

function context(userId: string): McpContext {
  return {
    userId,
    user: { id: userId, email: 'owner@example.com', name: 'Owner', image: null, role: 'user' },
    signal: new AbortController().signal,
  };
}

describe('list_repositories', () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
  });

  it('returns the accessible repositories as structured content', async () => {
    expect.assertions(2);
    mocks.listAccessibleRepositories.mockResolvedValue({
      ok: true,
      repositories: [repositoryProjection],
    });

    const result = await listRepositoriesTool.handler({ limit: 25, offset: 0 }, context('7'));

    expect(result.structuredContent).toEqual({
      repositories: [repositoryProjection],
      limit: 25,
      offset: 0,
      hasMore: false,
    });
    expect(mocks.listAccessibleRepositories).toHaveBeenCalledWith(7);
  });

  it('pages a large installation set and says more remain', async () => {
    expect.assertions(2);
    mocks.listAccessibleRepositories.mockResolvedValue({
      ok: true,
      repositories: [
        repositoryProjection,
        { ...repositoryProjection, id: 9002, name: 'cinder' },
        { ...repositoryProjection, id: 9003, name: 'agents' },
      ],
    });

    const result = await listRepositoriesTool.handler({ limit: 2, offset: 0 }, context('7'));

    expect(result.structuredContent).toMatchObject({ hasMore: true });
    expect(readToolResultText(result)).toMatch(/more available/);
  });

  it('frames the result as untrusted content', async () => {
    expect.assertions(1);
    mocks.listAccessibleRepositories.mockResolvedValue({ ok: true, repositories: [] });

    const result = await listRepositoriesTool.handler({ limit: 25, offset: 0 }, context('7'));

    expect(readToolResultText(result)).toMatch(/Untrusted content/);
  });

  it('refuses a subject that is not a Tribunal user identifier', async () => {
    expect.assertions(2);

    const result = await listRepositoriesTool.handler(
      { limit: 25, offset: 0 },
      context('not-an-id'),
    );

    expect(result.isError).toBe(true);
    expect(mocks.listAccessibleRepositories).not.toHaveBeenCalled();
  });

  it('reports a GitHub failure as a tool error', async () => {
    expect.assertions(2);
    mocks.listAccessibleRepositories.mockResolvedValue({
      ok: false,
      error: 'github_unavailable',
    });

    const result = await listRepositoriesTool.handler({ limit: 25, offset: 0 }, context('7'));

    expect(result.isError).toBe(true);
    expect(readToolResultText(result)).toMatch(/GitHub could not be reached/);
  });
});

describe('get_repository', () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
  });

  it('returns one repository', async () => {
    expect.assertions(1);
    mocks.findAccessibleRepository.mockResolvedValue({
      ok: true,
      repository: repositoryProjection,
    });

    const result = await getRepositoryTool.handler({ repositoryId: 9001 }, context('7'));

    expect(result.structuredContent).toEqual({ repository: repositoryProjection });
  });

  it('reports a repository outside the caller access as not found', async () => {
    expect.assertions(2);
    mocks.findAccessibleRepository.mockResolvedValue({ ok: true, repository: null });

    const result = await getRepositoryTool.handler({ repositoryId: 111222333 }, context('7'));

    expect(result.isError).toBe(true);
    expect(readToolResultText(result)).toMatch(/No repository matching that id/);
  });

  it('passes a read failure through as a tool error', async () => {
    expect.assertions(1);
    mocks.findAccessibleRepository.mockResolvedValue({ ok: false, error: 'no_github_token' });

    const result = await getRepositoryTool.handler({ repositoryId: 9001 }, context('7'));

    expect(readToolResultText(result)).toMatch(/no valid GitHub token/);
  });

  it('refuses an unbound subject', async () => {
    expect.assertions(1);

    const result = await getRepositoryTool.handler({ repositoryId: 9001 }, context('0'));

    expect(result.isError).toBe(true);
  });
});
