import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockGetRepositoryById,
  mockGetInstallationForRepository,
  mockUserCanAccessRepository,
  mockListIssues,
  mockParseIssueFilters,
} = vi.hoisted(() => ({
  mockGetRepositoryById: vi.fn(),
  mockGetInstallationForRepository: vi.fn(),
  mockUserCanAccessRepository: vi.fn(),
  mockListIssues: vi.fn(),
  mockParseIssueFilters: vi.fn(),
}));

vi.mock('@sveltejs/kit', () => ({
  redirect: (status: number, location: string) => {
    throw { status, location, type: 'redirect' };
  },
  error: (status: number, message: string) => {
    throw { status, body: { message }, type: 'error' };
  },
}));

vi.mock('@tribunal/github/repositories/service', () => ({
  getRepositoryById: mockGetRepositoryById,
  getInstallationForRepository: mockGetInstallationForRepository,
}));

vi.mock('@tribunal/github/issues/service', () => ({
  listIssues: mockListIssues,
  parseIssueFilters: mockParseIssueFilters,
}));

vi.mock('$lib/server/github-context', () => ({
  githubContext: {},
}));

vi.mock('$lib/server/repositories', () => ({
  userCanAccessRepository: mockUserCanAccessRepository,
}));

import { load } from './+page.server';

const defaultFilters = {
  state: 'open' as const,
  sort: 'updated' as const,
  direction: 'desc' as const,
  page: 1,
  perPage: 30,
};

function runLoad(url = 'https://example.com/repositories/1/issues') {
  return load({
    params: { repositoryId: '1' },
    locals: { user: { id: 1 } },
    url: new URL(url),
  } as never);
}

describe('repository issues page load', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockParseIssueFilters.mockReturnValue(defaultFilters);
  });

  it('redirects to /login when the user is not authenticated', async () => {
    expect.assertions(1);
    await expect(
      load({
        params: { repositoryId: '1' },
        locals: {},
        url: new URL('https://example.com'),
      } as never),
    ).rejects.toMatchObject({ status: 302, location: '/login' });
  });

  it('returns 404 when the repository does not exist', async () => {
    expect.assertions(1);
    mockGetRepositoryById.mockResolvedValue(null);

    await expect(runLoad()).rejects.toMatchObject({ status: 404 });
  });

  it('returns 404 when the user cannot access the repository', async () => {
    expect.assertions(1);
    mockGetRepositoryById.mockResolvedValue({ id: 1, owner: 'acme', name: 'widgets' });
    mockUserCanAccessRepository.mockResolvedValue(false);

    await expect(runLoad()).rejects.toMatchObject({ status: 404 });
  });

  it('returns 502 when GitHub cannot be reached for the repository', async () => {
    expect.assertions(1);
    mockGetRepositoryById.mockResolvedValue({ id: 1, owner: 'acme', name: 'widgets' });
    mockUserCanAccessRepository.mockResolvedValue(true);
    mockGetInstallationForRepository.mockResolvedValue({ ok: false, error: 'not_found' });

    await expect(runLoad()).rejects.toMatchObject({ status: 502 });
  });

  it('lists issues for an accessible repository', async () => {
    expect.assertions(1);
    mockGetRepositoryById.mockResolvedValue({ id: 1, owner: 'acme', name: 'widgets' });
    mockUserCanAccessRepository.mockResolvedValue(true);
    mockGetInstallationForRepository.mockResolvedValue({
      ok: true,
      octokit: {},
      owner: 'acme',
      repo: 'widgets',
    });
    mockListIssues.mockResolvedValue({
      issues: [{ number: 1, title: 'Bug', state: 'open' }],
      filters: defaultFilters,
      hasNextPage: false,
    });

    await expect(runLoad()).resolves.toMatchObject({
      repository: { id: 1, owner: 'acme', name: 'widgets' },
      issues: [{ number: 1, title: 'Bug', state: 'open' }],
      filters: defaultFilters,
      hasNextPage: false,
    });
  });

  it('parses filters from the request URL', async () => {
    expect.assertions(1);
    mockGetRepositoryById.mockResolvedValue({ id: 1, owner: 'acme', name: 'widgets' });
    mockUserCanAccessRepository.mockResolvedValue(true);
    mockGetInstallationForRepository.mockResolvedValue({
      ok: true,
      octokit: {},
      owner: 'acme',
      repo: 'widgets',
    });
    mockListIssues.mockResolvedValue({ issues: [], filters: defaultFilters, hasNextPage: false });

    await runLoad('https://example.com/repositories/1/issues?issue_state=closed');

    expect(mockParseIssueFilters).toHaveBeenCalledWith(
      new URL('https://example.com/repositories/1/issues?issue_state=closed'),
    );
  });

  it('forwards installation owner, repo, filters, and repository id to listIssues', async () => {
    expect.assertions(1);
    mockGetRepositoryById.mockResolvedValue({ id: 1, owner: 'acme', name: 'widgets' });
    mockUserCanAccessRepository.mockResolvedValue(true);
    const octokit = { rest: {} };
    mockGetInstallationForRepository.mockResolvedValue({
      ok: true,
      octokit,
      owner: 'acme',
      repo: 'widgets',
    });
    mockListIssues.mockResolvedValue({ issues: [], filters: defaultFilters, hasNextPage: false });

    await runLoad();

    expect(mockListIssues).toHaveBeenCalledWith({}, octokit, 'acme', 'widgets', defaultFilters, 1);
  });
});
