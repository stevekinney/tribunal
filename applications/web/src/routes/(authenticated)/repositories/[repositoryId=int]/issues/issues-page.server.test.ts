import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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

const directory = dirname(fileURLToPath(import.meta.url));
const pageSource = readFileSync(resolve(directory, './+page.svelte'), 'utf-8');

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

  it('returns 403 with a helpful message when GitHub denies access due to a missing Issues permission', async () => {
    expect.assertions(1);
    mockGetRepositoryById.mockResolvedValue({ id: 1, owner: 'acme', name: 'widgets' });
    mockUserCanAccessRepository.mockResolvedValue(true);
    mockGetInstallationForRepository.mockResolvedValue({
      ok: true,
      octokit: {},
      owner: 'acme',
      repo: 'widgets',
    });
    const forbidden = Object.assign(new Error('Resource not accessible by integration'), {
      status: 403,
      response: { data: { message: 'Resource not accessible by integration' }, headers: {} },
    });
    mockListIssues.mockRejectedValue(forbidden);

    await expect(runLoad()).rejects.toMatchObject({
      status: 403,
      body: { message: expect.stringContaining('Issues') },
    });
  });

  it('rethrows a rate-limit 403 instead of misreporting it as a missing permission', async () => {
    expect.assertions(1);
    mockGetRepositoryById.mockResolvedValue({ id: 1, owner: 'acme', name: 'widgets' });
    mockUserCanAccessRepository.mockResolvedValue(true);
    mockGetInstallationForRepository.mockResolvedValue({
      ok: true,
      octokit: {},
      owner: 'acme',
      repo: 'widgets',
    });
    const rateLimited = Object.assign(new Error('API rate limit exceeded'), {
      status: 403,
      response: {
        data: { message: 'API rate limit exceeded' },
        headers: { 'x-ratelimit-remaining': '0' },
      },
    });
    mockListIssues.mockRejectedValue(rateLimited);

    await expect(runLoad()).rejects.toBe(rateLimited);
  });

  it('returns 410 with a helpful message when the repository has Issues disabled', async () => {
    expect.assertions(1);
    // https://docs.github.com/en/rest/issues/issues#list-repository-issues —
    // "List repository issues" returns 410 Gone when a repository has
    // disabled the Issues feature entirely.
    mockGetRepositoryById.mockResolvedValue({ id: 1, owner: 'acme', name: 'widgets' });
    mockUserCanAccessRepository.mockResolvedValue(true);
    mockGetInstallationForRepository.mockResolvedValue({
      ok: true,
      octokit: {},
      owner: 'acme',
      repo: 'widgets',
    });
    const gone = Object.assign(new Error('Issues are disabled for this repo'), {
      status: 410,
      response: { data: { message: 'Issues are disabled for this repo' }, headers: {} },
    });
    mockListIssues.mockRejectedValue(gone);

    await expect(runLoad()).rejects.toMatchObject({
      status: 410,
      body: { message: expect.stringContaining('disabled') },
    });
  });

  it('returns 404 when GitHub reports the repository is gone, even though local rows still exist', async () => {
    expect.assertions(1);
    // https://docs.github.com/en/rest/issues/issues#list-repository-issues —
    // "List repository issues" can 404 when the local repository/installation
    // rows are stale relative to GitHub (repository deleted, transferred, or
    // the app lost access since we last synced). This should degrade like the
    // repository/access checks earlier in the load function, not surface a
    // generic 500.
    mockGetRepositoryById.mockResolvedValue({ id: 1, owner: 'acme', name: 'widgets' });
    mockUserCanAccessRepository.mockResolvedValue(true);
    mockGetInstallationForRepository.mockResolvedValue({
      ok: true,
      octokit: {},
      owner: 'acme',
      repo: 'widgets',
    });
    const notFound = Object.assign(new Error('Not Found'), {
      status: 404,
      response: { data: { message: 'Not Found' }, headers: {} },
    });
    mockListIssues.mockRejectedValue(notFound);

    await expect(runLoad()).rejects.toMatchObject({
      status: 404,
      body: { message: expect.stringContaining('not found') },
    });
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

describe('repository issues page interactions', () => {
  it('guards same-page pagination updates before navigating', () => {
    const handlerStart = pageSource.indexOf('function handlePageChange(nextPage: number): void');
    const handlerEnd = pageSource.indexOf('</script>', handlerStart);
    const handlerSource = pageSource.slice(handlerStart, handlerEnd);

    expect(handlerSource).toContain('if (nextPage === data.filters.page) return;');
    expect(handlerSource.indexOf('if (nextPage === data.filters.page) return;')).toBeLessThan(
      handlerSource.indexOf('updateFilters({ issue_page: String(nextPage) }'),
    );
  });
});
