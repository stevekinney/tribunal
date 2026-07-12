import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page as browserPage } from 'vitest/browser';
import { cleanup, render } from 'vitest-browser-svelte';
import PullRequestsPage from './+page.svelte';
import type { PageData } from './$types';

const mocks = vi.hoisted(() => ({
  svelteKitPage: {
    url: new URL('http://localhost/repositories/1/pull-requests'),
  },
  goto: vi.fn(),
}));

vi.mock('$app/state', () => ({
  page: mocks.svelteKitPage,
}));

vi.mock('$app/navigation', () => ({
  goto: mocks.goto,
}));

const baseData = {
  user: {
    id: 1,
    username: 'testuser',
    name: 'Test User',
    avatarUrl: null,
    email: 'test@example.com',
    isPlatformAdministrator: false,
  },
  reviewsEnabled: true,
  repository: {
    id: 1,
    owner: 'acme',
    name: 'widgets',
    review: {
      hasSavedSettings: false,
      watched: false,
      ignoreGlobs: [],
      agents: [],
      lastRunStatus: null,
      estimatedCostLast30DaysUsd: 0,
    },
  },
  agents: [],
  pullRequests: [],
  filters: {
    state: 'open' as const,
    sort: 'updated' as const,
    direction: 'desc' as const,
    page: 1,
    perPage: 30,
  },
  hasNextPage: false,
} satisfies PageData;

const samplePullRequest = {
  number: 42,
  title: 'Add new feature',
  state: 'open' as const,
  draft: false,
  mergedAt: null,
  htmlUrl: 'https://github.com/acme/widgets/pull/42',
  headRef: 'feature-branch',
  headSha: 'abc123sha',
  baseRef: 'main',
  updatedAt: '2024-01-16T12:00:00Z',
  author: { login: 'octocat', htmlUrl: 'https://github.com/octocat' },
  status: {
    ciStatus: 'passing' as const,
    checkCount: 3,
    resolvedReviewThreadCount: 1,
    unresolvedReviewThreadCount: 0,
    mergeConflictStatus: 'clean' as const,
    mergeableState: 'clean',
  },
};

describe('/repositories/[repositoryId]/pull-requests page', () => {
  beforeEach(() => {
    mocks.svelteKitPage.url = new URL('http://localhost/repositories/1/pull-requests');
    mocks.goto.mockReset();
  });

  afterEach(() => cleanup());

  it('shows the no-open-pull-requests empty state when there are no filters applied', async () => {
    render(PullRequestsPage, { data: baseData });

    await expect
      .element(browserPage.getByRole('heading', { name: 'No open pull requests' }))
      .toBeVisible();
  });

  it('shows a filtered empty state when filters are active and no rows match', async () => {
    render(PullRequestsPage, {
      data: { ...baseData, filters: { ...baseData.filters, state: 'closed' } },
    });

    await expect
      .element(browserPage.getByRole('heading', { name: 'No pull requests match these filters' }))
      .toBeVisible();
  });

  it('renders pull request rows with number, title, author, and branches', async () => {
    render(PullRequestsPage, { data: { ...baseData, pullRequests: [samplePullRequest] } });

    await expect.element(browserPage.getByRole('link', { name: 'Add new feature' })).toBeVisible();
    await expect.element(browserPage.getByText('#42')).toBeVisible();
    await expect.element(browserPage.getByText('by octocat')).toBeVisible();
    await expect.element(browserPage.getByText('feature-branch → main')).toBeVisible();
  });

  it('shows an Open badge for an open, non-draft pull request', async () => {
    render(PullRequestsPage, { data: { ...baseData, pullRequests: [samplePullRequest] } });

    await expect
      .element(browserPage.getByRole('listitem').getByText('Open', { exact: true }))
      .toBeVisible();
  });

  it('shows a Closed badge for a closed, unmerged pull request', async () => {
    render(PullRequestsPage, {
      data: {
        ...baseData,
        pullRequests: [{ ...samplePullRequest, state: 'closed', mergedAt: null }],
      },
    });

    await expect
      .element(browserPage.getByRole('listitem').getByText('Closed', { exact: true }))
      .toBeVisible();
  });

  it('shows a Merged badge for a closed, merged pull request', async () => {
    render(PullRequestsPage, {
      data: {
        ...baseData,
        pullRequests: [{ ...samplePullRequest, state: 'closed', mergedAt: '2024-01-17T00:00:00Z' }],
      },
    });

    await expect.element(browserPage.getByText('Merged', { exact: true })).toBeVisible();
  });

  it('shows a Draft badge for an open draft pull request', async () => {
    render(PullRequestsPage, {
      data: { ...baseData, pullRequests: [{ ...samplePullRequest, draft: true }] },
    });

    await expect.element(browserPage.getByText('Draft', { exact: true })).toBeVisible();
  });

  it('shows an honest, non-exact pull request count summary', async () => {
    render(PullRequestsPage, { data: { ...baseData, pullRequests: [samplePullRequest] } });

    await expect.element(browserPage.getByText('Showing 1 open pull request')).toBeVisible();
  });

  it('shows page-number summary copy when on a page beyond the first', async () => {
    render(PullRequestsPage, {
      data: {
        ...baseData,
        pullRequests: [samplePullRequest],
        filters: { ...baseData.filters, page: 2 },
        hasNextPage: false,
      },
    });

    await expect.element(browserPage.getByText('Showing page 2')).toBeVisible();
  });

  it('shows pagination when a next page is available', async () => {
    render(PullRequestsPage, {
      data: { ...baseData, pullRequests: [samplePullRequest], hasNextPage: true },
    });

    await expect.element(browserPage.getByRole('navigation', { name: 'Pagination' })).toBeVisible();
  });

  it('navigates to the next page and preserves other filters when Next is clicked', async () => {
    mocks.svelteKitPage.url = new URL('http://localhost/repositories/1/pull-requests?pr_base=main');
    render(PullRequestsPage, {
      data: {
        ...baseData,
        pullRequests: [samplePullRequest],
        filters: { ...baseData.filters, base: 'main' },
        hasNextPage: true,
      },
    });

    await browserPage.getByRole('button', { name: 'Go to next page' }).click();

    expect(mocks.goto).toHaveBeenCalledWith(
      expect.stringContaining('pr_page=2'),
      expect.objectContaining({ invalidateAll: true }),
    );
    expect(mocks.goto).toHaveBeenCalledWith(
      expect.stringContaining('pr_base=main'),
      expect.anything(),
    );
  });

  it('does not show label, assignee, creator, mentioned, or free-text filter controls', async () => {
    render(PullRequestsPage, { data: { ...baseData, pullRequests: [samplePullRequest] } });

    await expect
      .element(browserPage.getByRole('search', { name: 'Pull request filters' }))
      .toBeVisible();
    await expect.element(browserPage.getByLabelText('State')).toBeVisible();
    expect(browserPage.getByLabelText('Label').elements().length).toBe(0);
    expect(browserPage.getByLabelText('Assignee').elements().length).toBe(0);
    expect(browserPage.getByLabelText('Creator').elements().length).toBe(0);
    expect(browserPage.getByPlaceholder('Search').elements().length).toBe(0);
  });

  it('navigates with the state filter and resets to page 1 when a facet changes', async () => {
    render(PullRequestsPage, {
      data: { ...baseData, filters: { ...baseData.filters, page: 3 } },
    });

    const stateSelect = browserPage.getByLabelText('State');
    await stateSelect.selectOptions('closed');

    expect(mocks.goto).toHaveBeenCalledWith(
      expect.stringContaining('pr_state=closed'),
      expect.objectContaining({ invalidateAll: true }),
    );
    expect(mocks.goto).toHaveBeenCalledWith(expect.stringContaining('pr_page=1'), {
      keepFocus: true,
      noScroll: true,
      invalidateAll: true,
    });
  });

  it('preserves an in-flight facet change when another facet changes', async () => {
    render(PullRequestsPage, { data: baseData });

    await browserPage.getByLabelText('State').selectOptions('closed');
    await browserPage.getByLabelText('Sort').selectOptions('created');

    const secondNavigationTarget = mocks.goto.mock.calls.at(-1)?.[0];
    expect(secondNavigationTarget).toContain('pr_state=closed');
    expect(secondNavigationTarget).toContain('pr_sort=created');
    expect(secondNavigationTarget).toContain('pr_page=1');
  });

  it('navigates with a branch filter and resets to page 1', async () => {
    render(PullRequestsPage, {
      data: { ...baseData, filters: { ...baseData.filters, page: 3 } },
    });

    const baseBranchInput = browserPage.getByLabelText('Base branch');
    await baseBranchInput.fill('release');
    await browserPage.getByLabelText('Head branch').click();

    expect(mocks.goto).toHaveBeenCalledWith(expect.stringContaining('pr_base=release'), {
      keepFocus: true,
      noScroll: true,
      invalidateAll: true,
    });
    expect(mocks.goto).toHaveBeenCalledWith(
      expect.stringContaining('pr_page=1'),
      expect.anything(),
    );
  });

  it('clears all filters back to the pull request route', async () => {
    mocks.svelteKitPage.url = new URL(
      'http://localhost/repositories/1/pull-requests?pr_state=closed&pr_base=main',
    );
    render(PullRequestsPage, {
      data: {
        ...baseData,
        filters: { ...baseData.filters, state: 'closed', base: 'main' },
      },
    });

    await browserPage.getByRole('button', { name: 'Clear all filters' }).click();

    expect(mocks.goto).toHaveBeenCalledWith('/repositories/1/pull-requests', {
      keepFocus: true,
      noScroll: true,
      invalidateAll: true,
    });
  });

  it('preserves the base branch filter when changing the sort order', async () => {
    mocks.svelteKitPage.url = new URL('http://localhost/repositories/1/pull-requests?pr_base=main');
    render(PullRequestsPage, {
      data: { ...baseData, filters: { ...baseData.filters, base: 'main' } },
    });

    const sortSelect = browserPage.getByLabelText('Sort');
    await sortSelect.selectOptions('created');

    expect(mocks.goto).toHaveBeenCalledWith(
      expect.stringContaining('pr_base=main'),
      expect.objectContaining({ invalidateAll: true }),
    );
    expect(mocks.goto).toHaveBeenCalledWith(
      expect.stringContaining('pr_sort=created'),
      expect.anything(),
    );
  });
});
