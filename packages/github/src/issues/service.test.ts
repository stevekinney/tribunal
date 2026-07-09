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

import { parseIssueFilters, listIssues, type IssueFilterOptions } from './service.js';

describe('parseIssueFilters', () => {
  it('parses default filters from empty URL', () => {
    expect.assertions(9);
    const url = new URL('https://example.com/repo');
    const filters = parseIssueFilters(url);

    expect(filters.state).toBe('open');
    expect(filters.sort).toBe('updated');
    expect(filters.direction).toBe('desc');
    expect(filters.assignee).toBeUndefined();
    expect(filters.creator).toBeUndefined();
    expect(filters.mentioned).toBeUndefined();
    expect(filters.labels).toBeUndefined();
    expect(filters.page).toBe(1);
    expect(filters.perPage).toBe(30);
  });

  it('parses state parameter', () => {
    expect.assertions(3);
    const openUrl = new URL('https://example.com/repo?issue_state=open');
    expect(parseIssueFilters(openUrl).state).toBe('open');

    const closedUrl = new URL('https://example.com/repo?issue_state=closed');
    expect(parseIssueFilters(closedUrl).state).toBe('closed');

    const allUrl = new URL('https://example.com/repo?issue_state=all');
    expect(parseIssueFilters(allUrl).state).toBe('all');
  });

  it('validates state parameter and falls back to default', () => {
    expect.assertions(1);
    const url = new URL('https://example.com/repo?issue_state=invalid');
    expect(parseIssueFilters(url).state).toBe('open');
  });

  it('parses sort parameter', () => {
    expect.assertions(3);
    const createdUrl = new URL('https://example.com/repo?issue_sort=created');
    expect(parseIssueFilters(createdUrl).sort).toBe('created');

    const updatedUrl = new URL('https://example.com/repo?issue_sort=updated');
    expect(parseIssueFilters(updatedUrl).sort).toBe('updated');

    const commentsUrl = new URL('https://example.com/repo?issue_sort=comments');
    expect(parseIssueFilters(commentsUrl).sort).toBe('comments');
  });

  it('validates sort parameter and falls back to default', () => {
    expect.assertions(1);
    const url = new URL('https://example.com/repo?issue_sort=invalid');
    expect(parseIssueFilters(url).sort).toBe('updated');
  });

  it('parses direction parameter', () => {
    expect.assertions(2);
    const ascUrl = new URL('https://example.com/repo?issue_direction=asc');
    expect(parseIssueFilters(ascUrl).direction).toBe('asc');

    const descUrl = new URL('https://example.com/repo?issue_direction=desc');
    expect(parseIssueFilters(descUrl).direction).toBe('desc');
  });

  it('validates direction parameter and falls back to default', () => {
    expect.assertions(1);
    const url = new URL('https://example.com/repo?issue_direction=invalid');
    expect(parseIssueFilters(url).direction).toBe('desc');
  });

  it('parses assignee, creator, mentioned, labels, milestone, and type filters', () => {
    expect.assertions(6);
    const url = new URL(
      'https://example.com/repo?issue_assignee=octocat&issue_creator=hubot&issue_mentioned=monalisa&issue_labels=bug,urgent&issue_milestone=3&issue_type=bug',
    );
    const filters = parseIssueFilters(url);
    expect(filters.assignee).toBe('octocat');
    expect(filters.creator).toBe('hubot');
    expect(filters.mentioned).toBe('monalisa');
    expect(filters.labels).toBe('bug,urgent');
    expect(filters.milestone).toBe('3');
    expect(filters.type).toBe('bug');
  });

  it('treats empty assignee, creator, mentioned, and labels as undefined', () => {
    expect.assertions(4);
    const url = new URL(
      'https://example.com/repo?issue_assignee=&issue_creator=&issue_mentioned=&issue_labels=',
    );
    const filters = parseIssueFilters(url);
    expect(filters.assignee).toBeUndefined();
    expect(filters.creator).toBeUndefined();
    expect(filters.mentioned).toBeUndefined();
    expect(filters.labels).toBeUndefined();
  });

  it('parses page parameter with minimum of 1', () => {
    expect.assertions(3);
    const page5Url = new URL('https://example.com/repo?issue_page=5');
    expect(parseIssueFilters(page5Url).page).toBe(5);

    const page0Url = new URL('https://example.com/repo?issue_page=0');
    expect(parseIssueFilters(page0Url).page).toBe(1);

    const negativeUrl = new URL('https://example.com/repo?issue_page=-5');
    expect(parseIssueFilters(negativeUrl).page).toBe(1);
  });

  it('parses page parameter and handles invalid values', () => {
    expect.assertions(2);
    const invalidUrl = new URL('https://example.com/repo?issue_page=abc');
    expect(parseIssueFilters(invalidUrl).page).toBe(1);

    const floatUrl = new URL('https://example.com/repo?issue_page=2.5');
    expect(parseIssueFilters(floatUrl).page).toBe(2);
  });

  it('parses per_page with min 1 and max 100', () => {
    expect.assertions(4);
    const url50 = new URL('https://example.com/repo?issue_per_page=50');
    expect(parseIssueFilters(url50).perPage).toBe(50);

    // 0 is falsy, so it falls back to default (30)
    const url0 = new URL('https://example.com/repo?issue_per_page=0');
    expect(parseIssueFilters(url0).perPage).toBe(30);

    const url200 = new URL('https://example.com/repo?issue_per_page=200');
    expect(parseIssueFilters(url200).perPage).toBe(100);

    // Negative values are coerced to 1 via Math.max
    const urlNegative = new URL('https://example.com/repo?issue_per_page=-10');
    expect(parseIssueFilters(urlNegative).perPage).toBe(1);
  });

  it('combines multiple filter parameters', () => {
    expect.assertions(5);
    const url = new URL(
      'https://example.com/repo?issue_state=closed&issue_sort=comments&issue_direction=asc&issue_page=2&issue_per_page=50',
    );
    const filters = parseIssueFilters(url);

    expect(filters.state).toBe('closed');
    expect(filters.sort).toBe('comments');
    expect(filters.direction).toBe('asc');
    expect(filters.page).toBe(2);
    expect(filters.perPage).toBe(50);
  });
});

describe('listIssues', () => {
  const defaultFilters: IssueFilterOptions = {
    state: 'open',
    sort: 'updated',
    direction: 'desc',
    page: 1,
    perPage: 30,
  };

  function createMockOctokit(responseData: unknown[]) {
    return {
      rest: {
        issues: {
          listForRepo: vi.fn().mockResolvedValue({ data: responseData }),
        },
      },
    } as never;
  }

  it('returns empty list when no issues', async () => {
    expect.assertions(3);
    const context = createMockContext();
    const octokit = createMockOctokit([]);
    const result = await listIssues(context, octokit, 'owner', 'repo', defaultFilters);

    expect(result.issues).toHaveLength(0);
    expect(result.filters).toEqual(defaultFilters);
    expect(result.hasNextPage).toBe(false);
  });

  it('transforms issue list items', async () => {
    expect.assertions(13);
    const mockIssue = {
      number: 7,
      title: 'Something is broken',
      state: 'open',
      user: {
        login: 'octocat',
        avatar_url: 'https://avatars.example.com/u/1',
        html_url: 'https://github.com/octocat',
      },
      labels: [{ name: 'bug', color: 'ff0000', description: 'A bug' }],
      assignees: [
        {
          login: 'hubot',
          avatar_url: 'https://avatars.example.com/u/2',
          html_url: 'https://github.com/hubot',
        },
      ],
      comments: 3,
      created_at: '2024-01-15T10:00:00Z',
      updated_at: '2024-01-16T12:00:00Z',
      closed_at: null,
      milestone: {
        number: 1,
        title: 'v1.0',
        state: 'open',
        html_url: 'https://github.com/owner/repo/milestone/1',
      },
      type: { name: 'Bug' },
      html_url: 'https://github.com/owner/repo/issues/7',
    };

    const context = createMockContext();
    const octokit = createMockOctokit([mockIssue]);
    const result = await listIssues(context, octokit, 'owner', 'repo', defaultFilters);

    expect(result.issues).toHaveLength(1);
    const issue = result.issues[0];
    expect(issue.number).toBe(7);
    expect(issue.title).toBe('Something is broken');
    expect(issue.state).toBe('open');
    expect(issue.author?.login).toBe('octocat');
    expect(issue.labels[0].name).toBe('bug');
    expect(issue.assignees[0].login).toBe('hubot');
    expect(issue.commentCount).toBe(3);
    expect(issue.createdAt).toBe('2024-01-15T10:00:00Z');
    expect(issue.updatedAt).toBe('2024-01-16T12:00:00Z');
    expect(issue.milestone?.title).toBe('v1.0');
    expect(issue.issueType).toBe('Bug');
    expect(issue.htmlUrl).toBe('https://github.com/owner/repo/issues/7');
  });

  it('handles null author, milestone, and issue type', async () => {
    expect.assertions(3);
    const mockIssue = {
      number: 8,
      title: 'No author',
      state: 'open',
      user: null,
      labels: [],
      assignees: [],
      comments: 0,
      created_at: '2024-01-15T10:00:00Z',
      updated_at: '2024-01-15T10:00:00Z',
      closed_at: null,
      milestone: null,
      html_url: 'https://github.com/owner/repo/issues/8',
    };

    const context = createMockContext();
    const octokit = createMockOctokit([mockIssue]);
    const result = await listIssues(context, octokit, 'owner', 'repo', defaultFilters);

    expect(result.issues[0].author).toBeNull();
    expect(result.issues[0].milestone).toBeNull();
    expect(result.issues[0].issueType).toBeNull();
  });

  it('excludes rows with a pull_request key', async () => {
    expect.assertions(2);
    const mockIssue = {
      number: 9,
      title: 'A real issue',
      state: 'open',
      user: null,
      labels: [],
      assignees: [],
      comments: 0,
      created_at: '2024-01-15T10:00:00Z',
      updated_at: '2024-01-15T10:00:00Z',
      closed_at: null,
      milestone: null,
      html_url: 'https://github.com/owner/repo/issues/9',
    };
    const mockPullRequest = {
      ...mockIssue,
      number: 10,
      title: 'Actually a pull request',
      pull_request: {
        url: 'https://api.github.com/repos/owner/repo/pulls/10',
        html_url: 'https://github.com/owner/repo/pull/10',
        diff_url: 'https://github.com/owner/repo/pull/10.diff',
        patch_url: 'https://github.com/owner/repo/pull/10.patch',
      },
    };

    const context = createMockContext();
    const octokit = createMockOctokit([mockIssue, mockPullRequest]);
    const result = await listIssues(context, octokit, 'owner', 'repo', defaultFilters);

    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].number).toBe(9);
  });

  it('handles string labels', async () => {
    expect.assertions(3);
    const mockIssue = {
      number: 11,
      title: 'String labels',
      state: 'open',
      user: null,
      labels: ['bug', 'urgent'],
      assignees: [],
      comments: 0,
      created_at: '2024-01-15T10:00:00Z',
      updated_at: '2024-01-15T10:00:00Z',
      closed_at: null,
      milestone: null,
      html_url: 'https://github.com/owner/repo/issues/11',
    };

    const context = createMockContext();
    const octokit = createMockOctokit([mockIssue]);
    const result = await listIssues(context, octokit, 'owner', 'repo', defaultFilters);

    expect(result.issues[0].labels).toHaveLength(2);
    expect(result.issues[0].labels[0].name).toBe('bug');
    expect(result.issues[0].labels[1].name).toBe('urgent');
  });

  it('forwards filters and pagination parameters to the GitHub API', async () => {
    expect.assertions(1);
    const filters: IssueFilterOptions = {
      state: 'closed',
      sort: 'comments',
      direction: 'asc',
      assignee: 'octocat',
      creator: 'hubot',
      mentioned: 'monalisa',
      labels: 'bug,urgent',
      milestone: '3',
      type: 'bug',
      page: 2,
      perPage: 50,
    };

    const context = createMockContext();
    const octokit = createMockOctokit([]);
    await listIssues(context, octokit, 'owner', 'repo', filters);

    expect((octokit as any).rest.issues.listForRepo).toHaveBeenCalledWith({
      owner: 'owner',
      repo: 'repo',
      state: 'closed',
      sort: 'comments',
      direction: 'asc',
      assignee: 'octocat',
      creator: 'hubot',
      mentioned: 'monalisa',
      labels: 'bug,urgent',
      milestone: '3',
      type: 'bug',
      page: 2,
      per_page: 50,
    });
  });

  it('reports hasNextPage true when a full page is returned', async () => {
    expect.assertions(1);
    const filters: IssueFilterOptions = { ...defaultFilters, perPage: 2 };
    const mockIssue = (number: number) => ({
      number,
      title: `Issue ${number}`,
      state: 'open',
      user: null,
      labels: [],
      assignees: [],
      comments: 0,
      created_at: '2024-01-15T10:00:00Z',
      updated_at: '2024-01-15T10:00:00Z',
      closed_at: null,
      milestone: null,
      html_url: `https://github.com/owner/repo/issues/${number}`,
    });

    const context = createMockContext();
    const octokit = createMockOctokit([mockIssue(1), mockIssue(2)]);
    const result = await listIssues(context, octokit, 'owner', 'repo', filters);

    expect(result.hasNextPage).toBe(true);
  });

  it('uses the cache when a repositoryId is provided', async () => {
    expect.assertions(2);
    const context = createMockContext();
    const octokit = createMockOctokit([]);
    await listIssues(context, octokit, 'owner', 'repo', defaultFilters, 42);

    expect(context.cache.getCached).toHaveBeenCalled();
    expect(context.cache.setCache).toHaveBeenCalled();
  });
});
