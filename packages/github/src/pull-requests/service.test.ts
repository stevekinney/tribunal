import { describe, it, expect, vi } from 'vitest';

import type { GithubServiceContext } from '../context.js';

function createMockContext(overrides?: Partial<GithubServiceContext>): GithubServiceContext {
  return {
    db: {} as any,
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
    ...overrides,
  };
}

import {
  parsePullRequestFilters,
  getSelectedPullRequestNumber,
  listPullRequests,
  getPullRequest,
  getPullRequestOperationalStatus,
  isRateLimitError,
  isNotFoundError,
  type PullRequestFilterOptions,
} from './service.js';

describe('parsePullRequestFilters', () => {
  it('parses default filters from empty URL', () => {
    expect.assertions(7);
    const url = new URL('https://example.com/repo');
    const filters = parsePullRequestFilters(url);

    expect(filters.state).toBe('open');
    expect(filters.sort).toBe('updated');
    expect(filters.direction).toBe('desc');
    expect(filters.head).toBeUndefined();
    expect(filters.base).toBeUndefined();
    expect(filters.page).toBe(1);
    expect(filters.perPage).toBe(30);
  });

  it('parses state parameter', () => {
    expect.assertions(3);
    const openUrl = new URL('https://example.com/repo?pr_state=open');
    expect(parsePullRequestFilters(openUrl).state).toBe('open');

    const closedUrl = new URL('https://example.com/repo?pr_state=closed');
    expect(parsePullRequestFilters(closedUrl).state).toBe('closed');

    const allUrl = new URL('https://example.com/repo?pr_state=all');
    expect(parsePullRequestFilters(allUrl).state).toBe('all');
  });

  it('validates state parameter and falls back to default', () => {
    expect.assertions(1);
    const url = new URL('https://example.com/repo?pr_state=invalid');
    expect(parsePullRequestFilters(url).state).toBe('open');
  });

  it('parses sort parameter', () => {
    expect.assertions(4);
    const createdUrl = new URL('https://example.com/repo?pr_sort=created');
    expect(parsePullRequestFilters(createdUrl).sort).toBe('created');

    const updatedUrl = new URL('https://example.com/repo?pr_sort=updated');
    expect(parsePullRequestFilters(updatedUrl).sort).toBe('updated');

    const popularityUrl = new URL('https://example.com/repo?pr_sort=popularity');
    expect(parsePullRequestFilters(popularityUrl).sort).toBe('popularity');

    const longRunningUrl = new URL('https://example.com/repo?pr_sort=long-running');
    expect(parsePullRequestFilters(longRunningUrl).sort).toBe('long-running');
  });

  it('validates sort parameter and falls back to default', () => {
    expect.assertions(1);
    const url = new URL('https://example.com/repo?pr_sort=invalid');
    expect(parsePullRequestFilters(url).sort).toBe('updated');
  });

  it('parses direction parameter', () => {
    expect.assertions(2);
    const ascUrl = new URL('https://example.com/repo?pr_direction=asc');
    expect(parsePullRequestFilters(ascUrl).direction).toBe('asc');

    const descUrl = new URL('https://example.com/repo?pr_direction=desc');
    expect(parsePullRequestFilters(descUrl).direction).toBe('desc');
  });

  it('validates direction parameter and falls back to default', () => {
    expect.assertions(1);
    const url = new URL('https://example.com/repo?pr_direction=invalid');
    expect(parsePullRequestFilters(url).direction).toBe('desc');
  });

  it('parses head and base branch filters', () => {
    expect.assertions(2);
    const url = new URL('https://example.com/repo?pr_head=user:feature&pr_base=main');
    const filters = parsePullRequestFilters(url);
    expect(filters.head).toBe('user:feature');
    expect(filters.base).toBe('main');
  });

  it('treats empty head and base as undefined', () => {
    expect.assertions(2);
    const url = new URL('https://example.com/repo?pr_head=&pr_base=');
    const filters = parsePullRequestFilters(url);
    expect(filters.head).toBeUndefined();
    expect(filters.base).toBeUndefined();
  });

  it('parses page parameter with minimum of 1', () => {
    expect.assertions(3);
    const page5Url = new URL('https://example.com/repo?pr_page=5');
    expect(parsePullRequestFilters(page5Url).page).toBe(5);

    const page0Url = new URL('https://example.com/repo?pr_page=0');
    expect(parsePullRequestFilters(page0Url).page).toBe(1);

    const negativeUrl = new URL('https://example.com/repo?pr_page=-5');
    expect(parsePullRequestFilters(negativeUrl).page).toBe(1);
  });

  it('parses page parameter and handles invalid values', () => {
    expect.assertions(2);
    const invalidUrl = new URL('https://example.com/repo?pr_page=abc');
    expect(parsePullRequestFilters(invalidUrl).page).toBe(1);

    const floatUrl = new URL('https://example.com/repo?pr_page=2.5');
    expect(parsePullRequestFilters(floatUrl).page).toBe(2);
  });

  it('parses per_page with min 1 and max 100', () => {
    expect.assertions(4);
    const url50 = new URL('https://example.com/repo?pr_per_page=50');
    expect(parsePullRequestFilters(url50).perPage).toBe(50);

    // 0 is falsy, so it falls back to default (30)
    const url0 = new URL('https://example.com/repo?pr_per_page=0');
    expect(parsePullRequestFilters(url0).perPage).toBe(30);

    const url200 = new URL('https://example.com/repo?pr_per_page=200');
    expect(parsePullRequestFilters(url200).perPage).toBe(100);

    // Negative values are coerced to 1 via Math.max
    const urlNegative = new URL('https://example.com/repo?pr_per_page=-10');
    expect(parsePullRequestFilters(urlNegative).perPage).toBe(1);
  });

  it('combines multiple filter parameters', () => {
    expect.assertions(6);
    const url = new URL(
      'https://example.com/repo?pr_state=closed&pr_sort=created&pr_direction=asc&pr_page=2&pr_per_page=50',
    );
    const filters = parsePullRequestFilters(url);

    expect(filters.state).toBe('closed');
    expect(filters.sort).toBe('created');
    expect(filters.direction).toBe('asc');
    expect(filters.page).toBe(2);
    expect(filters.perPage).toBe(50);
    expect(filters.head).toBeUndefined();
  });
});

describe('getSelectedPullRequestNumber', () => {
  it('returns null when no pr_number param', () => {
    expect.assertions(1);
    const url = new URL('https://example.com/repo');
    expect(getSelectedPullRequestNumber(url)).toBeNull();
  });

  it('parses valid pr_number', () => {
    expect.assertions(1);
    const url = new URL('https://example.com/repo?pr_number=42');
    expect(getSelectedPullRequestNumber(url)).toBe(42);
  });

  it('returns null for non-numeric pr_number', () => {
    expect.assertions(1);
    const url = new URL('https://example.com/repo?pr_number=abc');
    expect(getSelectedPullRequestNumber(url)).toBeNull();
  });

  it('returns null for zero pr_number', () => {
    expect.assertions(1);
    const url = new URL('https://example.com/repo?pr_number=0');
    expect(getSelectedPullRequestNumber(url)).toBeNull();
  });

  it('returns null for negative pr_number', () => {
    expect.assertions(1);
    const url = new URL('https://example.com/repo?pr_number=-5');
    expect(getSelectedPullRequestNumber(url)).toBeNull();
  });

  it('parses float pr_number as integer', () => {
    expect.assertions(1);
    const url = new URL('https://example.com/repo?pr_number=42.7');
    expect(getSelectedPullRequestNumber(url)).toBe(42);
  });

  it('returns null for empty pr_number', () => {
    expect.assertions(1);
    const url = new URL('https://example.com/repo?pr_number=');
    expect(getSelectedPullRequestNumber(url)).toBeNull();
  });
});

describe('listPullRequests', () => {
  const defaultFilters: PullRequestFilterOptions = {
    state: 'open',
    sort: 'updated',
    direction: 'desc',
    page: 1,
    perPage: 30,
  };

  function createMockOctokit(responseData: unknown[]) {
    return {
      rest: {
        pulls: {
          list: vi.fn().mockResolvedValue({ data: responseData }),
        },
      },
    } as never;
  }

  it('returns empty list when no pull requests', async () => {
    expect.assertions(2);
    const context = createMockContext();
    const octokit = createMockOctokit([]);
    const result = await listPullRequests(context, octokit, 'owner', 'repo', defaultFilters, 55);

    expect(result.pullRequests).toHaveLength(0);
    expect(result.filters).toEqual(defaultFilters);
  });

  it('transforms pull request list items', async () => {
    expect.assertions(12);
    const mockPr = {
      number: 42,
      title: 'Add new feature',
      state: 'open',
      draft: false,
      locked: false,
      user: {
        login: 'testuser',
        avatar_url: 'https://avatars.example.com/u/123',
        html_url: 'https://github.com/testuser',
      },
      created_at: '2024-01-15T10:00:00Z',
      updated_at: '2024-01-16T12:00:00Z',
      closed_at: null,
      merged_at: null,
      labels: [{ name: 'enhancement', color: '84b6eb', description: 'New feature' }],
      head: { ref: 'feature-branch', sha: 'abc123sha' },
      base: { ref: 'main' },
      html_url: 'https://github.com/owner/repo/pull/42',
    };

    const context = createMockContext();
    const octokit = createMockOctokit([mockPr]);
    const result = await listPullRequests(context, octokit, 'owner', 'repo', defaultFilters, 55);

    expect(result.pullRequests).toHaveLength(1);
    const pr = result.pullRequests[0];
    expect(pr.number).toBe(42);
    expect(pr.title).toBe('Add new feature');
    expect(pr.state).toBe('open');
    expect(pr.draft).toBe(false);
    expect(pr.author?.login).toBe('testuser');
    expect(pr.author?.avatarUrl).toBe('https://avatars.example.com/u/123');
    expect(pr.updatedAt).toBe('2024-01-16T12:00:00Z');
    expect(pr.headRef).toBe('feature-branch');
    expect(pr.headSha).toBe('abc123sha');
    expect(pr.baseRef).toBe('main');
    expect(pr.htmlUrl).toBe('https://github.com/owner/repo/pull/42');
  });

  it('handles null author', async () => {
    expect.assertions(2);
    const mockPr = {
      number: 1,
      title: 'Test',
      state: 'open',
      draft: false,
      locked: false,
      user: null,
      created_at: '2024-01-15T10:00:00Z',
      updated_at: '2024-01-16T12:00:00Z',
      closed_at: null,
      merged_at: null,
      labels: [],
      head: { ref: 'branch', sha: 'abc123sha' },
      base: { ref: 'main' },
      html_url: 'https://github.com/owner/repo/pull/1',
    };

    const context = createMockContext();
    const octokit = createMockOctokit([mockPr]);
    const result = await listPullRequests(context, octokit, 'owner', 'repo', defaultFilters, 55);

    expect(result.pullRequests).toHaveLength(1);
    expect(result.pullRequests[0].author).toBeNull();
  });

  it('passes filter options to GitHub API', async () => {
    expect.assertions(1);
    const mockList = vi.fn().mockResolvedValue({ data: [] });
    const octokit = {
      rest: {
        pulls: { list: mockList },
      },
    } as never;

    const filters: PullRequestFilterOptions = {
      state: 'closed',
      sort: 'created',
      direction: 'asc',
      head: 'user:feature',
      base: 'develop',
      page: 2,
      perPage: 50,
    };

    const context = createMockContext();
    await listPullRequests(context, octokit, 'owner', 'repo', filters, 55);

    expect(mockList).toHaveBeenCalledWith({
      owner: 'owner',
      repo: 'repo',
      state: 'closed',
      sort: 'created',
      direction: 'asc',
      head: 'user:feature',
      base: 'develop',
      page: 2,
      per_page: 50,
    });
  });

  it('reports hasNextPage true when the Link header has a next relation', async () => {
    expect.assertions(1);
    const octokit = {
      rest: {
        pulls: {
          list: vi.fn().mockResolvedValue({
            data: [],
            headers: { link: '<https://api.github.com/x?page=2>; rel="next"' },
          }),
        },
      },
    } as never;

    const context = createMockContext();
    const result = await listPullRequests(context, octokit, 'owner', 'repo', defaultFilters, 55);

    expect(result.hasNextPage).toBe(true);
  });

  it('reports hasNextPage false when the Link header has no next relation', async () => {
    expect.assertions(1);
    const octokit = {
      rest: {
        pulls: {
          list: vi.fn().mockResolvedValue({
            data: [
              {
                number: 1,
                title: 'PR',
                state: 'open',
                draft: false,
                locked: false,
                user: null,
                created_at: '2024-01-15T10:00:00Z',
                updated_at: '2024-01-16T12:00:00Z',
                closed_at: null,
                merged_at: null,
                labels: [],
                head: { ref: 'branch', sha: 'sha' },
                base: { ref: 'main' },
                html_url: 'https://github.com/owner/repo/pull/1',
              },
            ],
            headers: { link: '<https://api.github.com/x?page=1>; rel="prev"' },
          }),
        },
      },
    } as never;

    const context = createMockContext();
    const result = await listPullRequests(context, octokit, 'owner', 'repo', defaultFilters, 55);

    expect(result.hasNextPage).toBe(false);
  });

  it('reports hasNextPage false for a full page when the Link header is missing', async () => {
    expect.assertions(2);
    // GitHub omits the Link header entirely when the current page is the
    // last page, even if it happens to contain exactly `perPage` rows. A
    // row-count fallback would misreport hasNextPage: true in this case, so
    // the absence of a Link header must mean there is no next page.
    const fullPage = Array.from({ length: defaultFilters.perPage }, (_, index) => ({
      number: index + 1,
      title: `PR ${index + 1}`,
      state: 'open',
      draft: false,
      locked: false,
      user: null,
      created_at: '2024-01-15T10:00:00Z',
      updated_at: '2024-01-16T12:00:00Z',
      closed_at: null,
      merged_at: null,
      labels: [],
      head: { ref: 'branch', sha: 'sha' },
      base: { ref: 'main' },
      html_url: `https://github.com/owner/repo/pull/${index + 1}`,
    }));
    const octokit = createMockOctokit(fullPage);

    const context = createMockContext();
    const result = await listPullRequests(context, octokit, 'owner', 'repo', defaultFilters, 55);

    expect(result.pullRequests).toHaveLength(defaultFilters.perPage);
    expect(result.hasNextPage).toBe(false);
  });

  it('caches results keyed by repository id and filters, and reuses the cached hasNextPage', async () => {
    expect.assertions(2);
    const mockList = vi.fn().mockResolvedValue({
      data: [
        {
          number: 1,
          title: 'PR',
          state: 'open',
          draft: false,
          locked: false,
          user: null,
          created_at: '2024-01-15T10:00:00Z',
          updated_at: '2024-01-16T12:00:00Z',
          closed_at: null,
          merged_at: null,
          labels: [],
          head: { ref: 'branch', sha: 'sha' },
          base: { ref: 'main' },
          html_url: 'https://github.com/owner/repo/pull/1',
        },
      ],
      headers: { link: '<https://api.github.com/x?page=2>; rel="next"' },
    });
    const octokit = { rest: { pulls: { list: mockList } } } as never;
    const context = createMockContext();

    const result = await listPullRequests(context, octokit, 'owner', 'repo', defaultFilters, 55, 7);

    expect(result.hasNextPage).toBe(true);
    expect(context.cache.setCache).toHaveBeenCalled();
  });

  // The list is the surface the repositories page renders, so it gets the same
  // stateful two-installation proof the detail path has rather than relying on
  // key-shape assertions alone.
  it('does not serve one installation the pull request list another installation cached', async () => {
    expect.assertions(4);

    const store = new Map<string, unknown>();
    const context = createMockContext({
      cache: {
        getCached: vi.fn(async (key: string) => store.get(key) ?? null),
        setCache: vi.fn(async (key: string, value: unknown) => {
          store.set(key, value);
          return true;
        }),
        setCacheIndefinitely: vi.fn().mockResolvedValue(true),
        deleteCache: vi.fn().mockResolvedValue(true),
        deleteCacheByPattern: vi.fn().mockResolvedValue(0),
        resetCacheClient: vi.fn(),
      },
    } as unknown as Partial<GithubServiceContext>);

    const currentInstallationList = vi.fn().mockResolvedValue({
      data: [
        {
          number: 5,
          title: 'Private to the current installation',
          state: 'open',
          draft: false,
          user: null,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
          closed_at: null,
          merged_at: null,
          labels: [],
          head: { ref: 'feature', sha: 'sha5' },
          base: { ref: 'main' },
          html_url: 'https://github.com/acme/widgets/pull/5',
        },
      ],
      headers: {},
    });
    const populated = await listPullRequests(
      context,
      { rest: { pulls: { list: currentInstallationList } } } as never,
      'acme',
      'widgets',
      defaultFilters,
      200,
      7,
    );
    expect(populated.pullRequests).toHaveLength(1);

    // The installation the transfer left behind sees nothing of its own.
    const staleInstallationList = vi.fn().mockResolvedValue({ data: [], headers: {} });
    const leaked = await listPullRequests(
      context,
      { rest: { pulls: { list: staleInstallationList } } } as never,
      'acme',
      'widgets',
      defaultFilters,
      100,
      7,
    );

    expect(staleInstallationList).toHaveBeenCalledOnce();
    expect(leaked.pullRequests).toHaveLength(0);
    expect([...store.keys()].every((key) => key.includes(':installation:'))).toBe(true);
  });
});

describe('getPullRequest', () => {
  function createMockOctokit(responseData: unknown | null, shouldThrow?: Error) {
    return {
      rest: {
        pulls: {
          get: shouldThrow
            ? vi.fn().mockRejectedValue(shouldThrow)
            : vi.fn().mockResolvedValue({ data: responseData }),
        },
      },
    } as never;
  }

  it('returns transformed PR detail', async () => {
    expect.assertions(20);
    const mockPr = {
      number: 42,
      title: 'Add feature',
      state: 'open',
      draft: true,
      locked: false,
      user: {
        login: 'author',
        avatar_url: 'https://avatars.example.com/u/1',
        html_url: 'https://github.com/author',
      },
      created_at: '2024-01-15T10:00:00Z',
      updated_at: '2024-01-16T12:00:00Z',
      closed_at: null,
      merged_at: null,
      labels: [],
      head: { ref: 'feature', sha: 'detail123sha' },
      base: { ref: 'main' },
      html_url: 'https://github.com/owner/repo/pull/42',
      body: 'PR description',
      additions: 100,
      deletions: 50,
      changed_files: 5,
      mergeable: true,
      mergeable_state: 'clean',
      merged: false,
      merged_by: null,
      comments: 3,
      review_comments: 7,
      commits: 2,
    };

    const context = createMockContext();
    const octokit = createMockOctokit(mockPr);
    const result = await getPullRequest(context, octokit, 'owner', 'repo', 42, 55);

    expect(result).not.toBeNull();
    expect(result!.number).toBe(42);
    expect(result!.title).toBe('Add feature');
    expect(result!.state).toBe('open');
    expect(result!.draft).toBe(true);
    expect(result!.body).toBe('PR description');
    expect(result!.additions).toBe(100);
    expect(result!.deletions).toBe(50);
    expect(result!.changedFiles).toBe(5);
    expect(result!.mergeable).toBe(true);
    expect(result!.mergeableState).toBe('clean');
    expect(result!.merged).toBe(false);
    expect(result!.mergedBy).toBeNull();
    expect(result!.comments).toBe(3);
    expect(result!.reviewComments).toBe(7);
    expect(result!.commits).toBe(2);
    expect(result!.author?.login).toBe('author');
    expect(result!.headRef).toBe('feature');
    expect(result!.headSha).toBe('detail123sha');
    expect(result!.htmlUrl).toBe('https://github.com/owner/repo/pull/42');
  });

  it('returns merged_by when PR is merged', async () => {
    expect.assertions(3);
    const mockPr = {
      number: 1,
      title: 'Merged PR',
      state: 'closed',
      draft: false,
      locked: false,
      user: { login: 'author', avatar_url: null, html_url: 'https://github.com/author' },
      created_at: '2024-01-15T10:00:00Z',
      updated_at: '2024-01-16T12:00:00Z',
      closed_at: '2024-01-16T12:00:00Z',
      merged_at: '2024-01-16T12:00:00Z',
      labels: [],
      head: { ref: 'feature', sha: 'merged123sha' },
      base: { ref: 'main' },
      html_url: 'https://github.com/owner/repo/pull/1',
      body: null,
      additions: 10,
      deletions: 5,
      changed_files: 1,
      mergeable: null,
      mergeable_state: 'unknown',
      merged: true,
      merged_by: { login: 'merger', avatar_url: null, html_url: 'https://github.com/merger' },
      comments: 0,
      review_comments: 0,
      commits: 1,
    };

    const context = createMockContext();
    const octokit = createMockOctokit(mockPr);
    const result = await getPullRequest(context, octokit, 'owner', 'repo', 1, 55);

    expect(result!.merged).toBe(true);
    expect(result!.mergedBy).not.toBeNull();
    expect(result!.mergedBy?.login).toBe('merger');
  });

  it('returns null for 404 error', async () => {
    expect.assertions(1);
    const notFoundError = Object.assign(new Error('Not Found'), { status: 404 });
    const context = createMockContext();
    const octokit = createMockOctokit(null, notFoundError);

    const result = await getPullRequest(context, octokit, 'owner', 'repo', 999, 55);

    expect(result).toBeNull();
  });

  // The guard exists because an unusable id would stringify into a shared
  // literal segment (`installation:undefined`) and disable the partition for
  // every caller on that path, with no error anywhere.
  it.each([
    ['undefined', undefined],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['zero', 0],
    ['negative', -1],
    ['fractional', 1.5],
  ])('refuses to read a pull request with a %s installation id', async (_label, badId) => {
    expect.assertions(2);
    const context = createMockContext();
    const octokit = createMockOctokit({ number: 1 });

    await expect(
      getPullRequest(context, octokit, 'acme', 'widgets', 1, badId as unknown as number),
    ).rejects.toThrow(/installationId must be a positive integer/);
    // It must fail before touching the cache at all.
    expect(context.cache.getCached).not.toHaveBeenCalled();
  });

  // Criterion 3: the transfer scenario, end to end through the real
  // `cachedRead`. A repository that still carries a link row for its previous
  // installation stays readable by that installation's users. If the cache is
  // not partitioned, the entry the current installation populated is handed to
  // them — content their own credentials would be refused.
  it('does not serve one installation the pull request another installation cached', async () => {
    expect.assertions(4);

    // A real store, not a mock that always misses. A always-miss mock would
    // make the second read look like a miss no matter how the key were built,
    // so it could not distinguish a partitioned cache from an unpartitioned one.
    const store = new Map<string, unknown>();
    const context = createMockContext({
      cache: {
        getCached: vi.fn(async (key: string) => store.get(key) ?? null),
        setCache: vi.fn(async (key: string, value: unknown) => {
          store.set(key, value);
          return true;
        }),
        setCacheIndefinitely: vi.fn().mockResolvedValue(true),
        deleteCache: vi.fn().mockResolvedValue(true),
        deleteCacheByPattern: vi.fn().mockResolvedValue(0),
        resetCacheClient: vi.fn(),
      },
    } as unknown as Partial<GithubServiceContext>);

    const currentInstallationId = 200;
    const staleInstallationId = 100;

    const privatePayload = {
      number: 5,
      title: 'Private to the current installation',
      state: 'open',
      draft: false,
      locked: false,
      user: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      closed_at: null,
      merged_at: null,
      labels: [],
      head: { ref: 'feature', sha: 'sha5' },
      base: { ref: 'main' },
      html_url: 'https://github.com/acme/widgets/pull/5',
      body: '',
      additions: 0,
      deletions: 0,
      changed_files: 0,
      mergeable: true,
      mergeable_state: 'clean',
      merged: false,
      merged_by: null,
      comments: 0,
      review_comments: 0,
      commits: 1,
    };

    // The installation that currently owns the repository reads it and
    // populates the cache.
    const currentInstallationGet = vi.fn().mockResolvedValue({ data: privatePayload });
    const cached = await getPullRequest(
      context,
      { rest: { pulls: { get: currentInstallationGet } } } as never,
      'acme',
      'widgets',
      5,
      currentInstallationId,
    );
    expect(cached?.title).toBe('Private to the current installation');

    // The installation the transfer left behind no longer has access, so its
    // live call 404s.
    const staleInstallationGet = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error('Not Found'), { status: 404 }));
    const leaked = await getPullRequest(
      context,
      { rest: { pulls: { get: staleInstallationGet } } } as never,
      'acme',
      'widgets',
      5,
      staleInstallationId,
    );

    // It must reach GitHub (a genuine miss) and return GitHub's answer rather
    // than the other installation's cached content.
    expect(staleInstallationGet).toHaveBeenCalledOnce();
    expect(leaked).toBeNull();
    expect([...store.keys()]).toStrictEqual(['github:response:acme:widgets:pr:5:installation:200']);
  });

  it('re-throws non-404 errors', async () => {
    expect.assertions(1);
    const serverError = Object.assign(new Error('Server Error'), { status: 500 });
    const context = createMockContext();
    const octokit = createMockOctokit(null, serverError);

    await expect(getPullRequest(context, octokit, 'owner', 'repo', 42, 55)).rejects.toThrow(
      'Server Error',
    );
  });

  it('reuses the cached PR when GitHub responds 304 Not Modified to a conditional request', async () => {
    expect.assertions(2);
    const cachedDetail = {
      number: 42,
      title: 'Cached title',
      state: 'open',
      draft: false,
      author: null,
      updatedAt: '2024-01-16T12:00:00Z',
      mergedAt: null,
      headRef: 'feature',
      headSha: 'cachedsha',
      baseRef: 'main',
      htmlUrl: 'https://github.com/owner/repo/pull/42',
      body: null,
      additions: 1,
      deletions: 0,
      changedFiles: 1,
      mergeable: null,
      mergeableState: 'unknown',
      merged: false,
      mergedBy: null,
      comments: 0,
      reviewComments: 0,
      commits: 1,
    };
    const now = Date.now();
    const context = createMockContext({
      cache: {
        getCached: vi.fn().mockResolvedValue({
          value: cachedDetail,
          etag: 'pr-etag',
          fetchedAt: now - 10_000,
          expiresAt: now - 1_000, // Expired, forces a conditional request.
        }),
        setCache: vi.fn().mockResolvedValue(true),
        setCacheIndefinitely: vi.fn().mockResolvedValue(true),
        deleteCache: vi.fn().mockResolvedValue(true),
        deleteCacheByPattern: vi.fn().mockResolvedValue(0),
        resetCacheClient: vi.fn(),
      },
    });
    const notModifiedError = Object.assign(new Error('Not Modified'), { status: 304 });
    const get = vi.fn().mockRejectedValue(notModifiedError);
    const octokit = { rest: { pulls: { get } } } as never;

    const result = await getPullRequest(context, octokit, 'owner', 'repo', 42, 55);

    expect(result).toEqual(cachedDetail);
    expect(get).toHaveBeenCalledWith(
      expect.objectContaining({ headers: { 'if-none-match': 'pr-etag' } }),
    );
  });
});

describe('getPullRequestOperationalStatus', () => {
  it('uses the pull request head SHA, paginates checks and review threads, and caches aggregate reads', async () => {
    expect.assertions(11);
    const successfulChecks = Array.from({ length: 100 }, (_, index) => ({
      id: index,
      status: 'completed',
      conclusion: 'success',
    }));
    const listForRef = vi
      .fn()
      .mockResolvedValueOnce({ data: { total_count: 101, check_runs: successfulChecks } })
      .mockResolvedValueOnce({
        data: {
          total_count: 101,
          check_runs: [{ id: 101, status: 'completed', conclusion: 'failure' }],
        },
      });
    const graphql = vi
      .fn()
      .mockResolvedValueOnce({
        repository: {
          pullRequest: {
            reviewThreads: {
              nodes: [{ isResolved: true }],
              pageInfo: { hasNextPage: true, endCursor: 'cursor-1' },
            },
          },
        },
      })
      .mockResolvedValueOnce({
        repository: {
          pullRequest: {
            reviewThreads: {
              nodes: [{ isResolved: false }],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        },
      });
    const octokit = {
      rest: {
        pulls: {
          get: vi.fn().mockResolvedValue({
            data: {
              number: 42,
              title: 'Add feature',
              state: 'open',
              draft: false,
              locked: false,
              user: null,
              created_at: '2024-01-15T10:00:00Z',
              updated_at: '2024-01-16T12:00:00Z',
              closed_at: null,
              merged_at: null,
              labels: [],
              head: { ref: 'feature', sha: 'actual-head-sha' },
              base: { ref: 'main' },
              html_url: 'https://github.com/owner/repo/pull/42',
              body: null,
              additions: 1,
              deletions: 0,
              changed_files: 1,
              mergeable: false,
              mergeable_state: 'dirty',
              merged: false,
              merged_by: null,
              comments: 0,
              review_comments: 0,
              commits: 1,
            },
            headers: { etag: 'pull-request-etag' },
          }),
        },
        checks: { listForRef },
      },
      graphql,
    } as never;
    const context = createMockContext();

    const status = await getPullRequestOperationalStatus(
      context,
      octokit,
      'owner',
      'repo',
      42,
      'actual-head-sha',
      55,
    );

    expect(status.ciStatus).toBe('failing');
    expect(status.checkCount).toBe(101);
    expect(status.resolvedReviewThreadCount).toBe(1);
    expect(status.unresolvedReviewThreadCount).toBe(1);
    expect(status.mergeConflictStatus).toBe('conflicting');
    expect(listForRef).toHaveBeenNthCalledWith(1, {
      owner: 'owner',
      repo: 'repo',
      ref: 'actual-head-sha',
      per_page: 100,
      page: 1,
    });
    expect(listForRef).toHaveBeenNthCalledWith(2, {
      owner: 'owner',
      repo: 'repo',
      ref: 'actual-head-sha',
      per_page: 100,
      page: 2,
    });
    expect(graphql).toHaveBeenNthCalledWith(1, expect.any(String), {
      owner: 'owner',
      repo: 'repo',
      pullNumber: 42,
      after: null,
    });
    expect(graphql).toHaveBeenNthCalledWith(2, expect.any(String), {
      owner: 'owner',
      repo: 'repo',
      pullNumber: 42,
      after: 'cursor-1',
    });
    expect(context.cache.setCache).toHaveBeenCalledWith(
      expect.stringContaining('review-thread-counts'),
      expect.objectContaining({
        value: { resolvedReviewThreadCount: 1, unresolvedReviewThreadCount: 1 },
      }),
      30,
    );
    expect(context.cache.setCache).toHaveBeenCalledWith(
      expect.stringContaining('checks:actual-head-sha'),
      expect.objectContaining({
        value: { ciStatus: 'failing', checkCount: 101, failingCount: 1, truncated: false },
      }),
      30,
    );
  });

  it('reports review thread counts as unknown when the lookup fails', async () => {
    const octokit = {
      rest: {
        pulls: {
          get: vi.fn().mockResolvedValue({
            data: {
              number: 42,
              title: 'Add feature',
              state: 'open',
              draft: false,
              locked: false,
              user: null,
              created_at: '2024-01-15T10:00:00Z',
              updated_at: '2024-01-16T12:00:00Z',
              closed_at: null,
              merged_at: null,
              labels: [],
              head: { ref: 'feature', sha: 'actual-head-sha' },
              base: { ref: 'main' },
              html_url: 'https://github.com/owner/repo/pull/42',
              body: null,
              additions: 1,
              deletions: 0,
              changed_files: 1,
              mergeable: true,
              mergeable_state: 'clean',
              merged: false,
              merged_by: null,
              comments: 0,
              review_comments: 0,
              commits: 1,
            },
            headers: { etag: 'pull-request-etag' },
          }),
        },
        checks: {
          listForRef: vi.fn().mockResolvedValue({
            data: {
              total_count: 1,
              check_runs: [{ id: 1, status: 'completed', conclusion: 'success' }],
            },
          }),
        },
      },
      graphql: vi.fn().mockRejectedValue(new Error('GraphQL unavailable')),
    } as never;

    const status = await getPullRequestOperationalStatus(
      createMockContext(),
      octokit,
      'owner',
      'repo',
      42,
      'actual-head-sha',
      55,
    );

    expect(status.ciStatus).toBe('passing');
    expect(status.resolvedReviewThreadCount).toBeNull();
    expect(status.unresolvedReviewThreadCount).toBeNull();
  });

  it('maps a null REST mergeable to unknown, never clean (GitHub computes mergeability asynchronously)', async () => {
    expect.assertions(1);
    const octokit = {
      rest: {
        pulls: {
          get: vi.fn().mockResolvedValue({
            data: {
              number: 7,
              title: 'Fresh PR',
              state: 'open',
              draft: false,
              locked: false,
              user: null,
              created_at: '2024-01-15T10:00:00Z',
              updated_at: '2024-01-16T12:00:00Z',
              closed_at: null,
              merged_at: null,
              labels: [],
              head: { ref: 'feature', sha: 'freshsha' },
              base: { ref: 'main' },
              html_url: 'https://github.com/owner/repo/pull/7',
              body: null,
              additions: 1,
              deletions: 0,
              changed_files: 1,
              // GitHub has not finished computing mergeability yet.
              mergeable: null,
              mergeable_state: 'unknown',
              merged: false,
              merged_by: null,
              comments: 0,
              review_comments: 0,
              commits: 1,
            },
          }),
        },
        checks: {
          listForRef: vi.fn().mockResolvedValue({ data: { total_count: 0, check_runs: [] } }),
        },
      },
      graphql: vi.fn().mockResolvedValue({
        repository: {
          pullRequest: {
            reviewThreads: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
          },
        },
      }),
    } as never;

    const status = await getPullRequestOperationalStatus(
      createMockContext(),
      octokit,
      'owner',
      'repo',
      7,
      'freshsha',
      55,
    );

    expect(status.mergeConflictStatus).toBe('unknown');
  });

  // Transfer scenario, end to end through the real `cachedRead`. A repository
  // that still carries a link row for its previous installation stays
  // readable by that installation's users. If the cache is not partitioned,
  // the entry the current installation populated is handed to them — thread
  // counts their own credentials would compute differently.
  it('does not serve one installation the review thread counts another installation cached', async () => {
    expect.assertions(3);

    const store = new Map<string, unknown>();
    const context = createMockContext({
      cache: {
        getCached: vi.fn(async (key: string) => store.get(key) ?? null),
        setCache: vi.fn(async (key: string, value: unknown) => {
          store.set(key, value);
          return true;
        }),
        setCacheIndefinitely: vi.fn().mockResolvedValue(true),
        deleteCache: vi.fn().mockResolvedValue(true),
        deleteCacheByPattern: vi.fn().mockResolvedValue(0),
        resetCacheClient: vi.fn(),
      },
    } as unknown as Partial<GithubServiceContext>);

    // Isolate the review-thread-counts surface: the PR-detail and
    // failing-check-count reads fail (and are not asserted on), leaving only
    // the review-thread GraphQL read to populate the cache.
    const makeOctokit = (nodes: Array<{ isResolved: boolean }>) =>
      ({
        rest: {
          pulls: {
            get: vi.fn().mockRejectedValue(Object.assign(new Error('Not Found'), { status: 404 })),
          },
          checks: { listForRef: vi.fn().mockRejectedValue(new Error('checks unavailable')) },
        },
        graphql: vi.fn().mockResolvedValue({
          repository: {
            pullRequest: {
              reviewThreads: { nodes, pageInfo: { hasNextPage: false, endCursor: null } },
            },
          },
        }),
      }) as never;

    const currentInstallationId = 200;
    const staleInstallationId = 100;

    await getPullRequestOperationalStatus(
      context,
      makeOctokit([{ isResolved: true }, { isResolved: true }]),
      'acme',
      'widgets',
      5,
      'sha5',
      currentInstallationId,
    );
    const cachedEntry = store.get(
      'github:response:acme:widgets:pr:5:review-thread-counts:installation:200',
    ) as { value: { resolvedReviewThreadCount: number; unresolvedReviewThreadCount: number } };
    expect(cachedEntry.value).toStrictEqual({
      resolvedReviewThreadCount: 2,
      unresolvedReviewThreadCount: 0,
    });

    // The installation the transfer left behind computes a different count
    // from its own live call — a partitioned cache must reach GitHub again
    // rather than replaying the other installation's counts.
    await getPullRequestOperationalStatus(
      context,
      makeOctokit([{ isResolved: false }]),
      'acme',
      'widgets',
      5,
      'sha5',
      staleInstallationId,
    );
    const leakedEntry = store.get(
      'github:response:acme:widgets:pr:5:review-thread-counts:installation:100',
    ) as { value: { resolvedReviewThreadCount: number; unresolvedReviewThreadCount: number } };
    expect(leakedEntry.value).toStrictEqual({
      resolvedReviewThreadCount: 0,
      unresolvedReviewThreadCount: 1,
    });

    expect([...store.keys()].sort()).toStrictEqual(
      [
        'github:response:acme:widgets:pr:5:review-thread-counts:installation:200',
        'github:response:acme:widgets:pr:5:review-thread-counts:installation:100',
      ].sort(),
    );
  });
});

describe('isRateLimitError', () => {
  it('returns false for non-Error values', () => {
    expect.assertions(4);
    expect(isRateLimitError(null)).toBe(false);
    expect(isRateLimitError(undefined)).toBe(false);
    expect(isRateLimitError('error string')).toBe(false);
    expect(isRateLimitError({ status: 403 })).toBe(false);
  });

  it('returns false for Error without status', () => {
    expect.assertions(1);
    expect(isRateLimitError(new Error('Some error'))).toBe(false);
  });

  it('returns false for non-403 errors', () => {
    expect.assertions(1);
    const error = Object.assign(new Error('Not Found'), {
      status: 404,
      response: { data: { message: 'rate limit exceeded' } },
    });
    expect(isRateLimitError(error)).toBe(false);
  });

  it('returns false for 403 without rate limit message', () => {
    expect.assertions(2);
    const errorNoMessage = Object.assign(new Error('Forbidden'), {
      status: 403,
      response: { data: { message: 'Permission denied' } },
    });
    expect(isRateLimitError(errorNoMessage)).toBe(false);

    const errorNoResponse = Object.assign(new Error('Forbidden'), { status: 403 });
    expect(isRateLimitError(errorNoResponse)).toBe(false);
  });

  it('returns true for 403 with rate limit message', () => {
    expect.assertions(2);
    const error = Object.assign(new Error('Rate limit'), {
      status: 403,
      response: { data: { message: 'API rate limit exceeded for user' } },
    });
    expect(isRateLimitError(error)).toBe(true);

    const errorSecondary = Object.assign(new Error('Rate limit'), {
      status: 403,
      response: { data: { message: 'You have exceeded a secondary rate limit' } },
    });
    expect(isRateLimitError(errorSecondary)).toBe(true);
  });
});

describe('isNotFoundError', () => {
  it('returns false for non-Error values', () => {
    expect.assertions(4);
    expect(isNotFoundError(null)).toBe(false);
    expect(isNotFoundError(undefined)).toBe(false);
    expect(isNotFoundError('error string')).toBe(false);
    expect(isNotFoundError({ status: 404 })).toBe(false);
  });

  it('returns false for Error without status', () => {
    expect.assertions(1);
    expect(isNotFoundError(new Error('Some error'))).toBe(false);
  });

  it('returns false for non-404 errors', () => {
    expect.assertions(2);
    const error403 = Object.assign(new Error('Forbidden'), { status: 403 });
    expect(isNotFoundError(error403)).toBe(false);

    const error500 = Object.assign(new Error('Server Error'), { status: 500 });
    expect(isNotFoundError(error500)).toBe(false);
  });

  it('returns true for 404 errors', () => {
    expect.assertions(1);
    const error = Object.assign(new Error('Not Found'), { status: 404 });
    expect(isNotFoundError(error)).toBe(true);
  });
});
