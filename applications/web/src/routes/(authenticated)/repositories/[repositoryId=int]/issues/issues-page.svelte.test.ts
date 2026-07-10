import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page as browserPage } from 'vitest/browser';
import { cleanup, render } from 'vitest-browser-svelte';
import IssuesPage from './+page.svelte';
import type { PageData } from './$types';

const mocks = vi.hoisted(() => ({
  svelteKitPage: {
    url: new URL('http://localhost/repositories/1/issues'),
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
  repository: { id: 1, owner: 'acme', name: 'widgets' },
  issues: [],
  filters: {
    state: 'open' as const,
    sort: 'updated' as const,
    direction: 'desc' as const,
    page: 1,
    perPage: 30,
  },
  hasNextPage: false,
} satisfies PageData;

const sampleIssue = {
  number: 42,
  title: 'Widget crashes on load',
  state: 'open' as const,
  author: { login: 'octocat', avatarUrl: null, htmlUrl: 'https://github.com/octocat' },
  labels: [{ name: 'bug', color: 'ff0000', description: null }],
  assignees: [{ login: 'hubot', avatarUrl: null, htmlUrl: 'https://github.com/hubot' }],
  commentCount: 3,
  createdAt: '2024-01-15T10:00:00Z',
  updatedAt: '2024-01-16T12:00:00Z',
  closedAt: null,
  milestone: null,
  issueType: null,
  htmlUrl: 'https://github.com/acme/widgets/issues/42',
};

describe('/repositories/[repositoryId]/issues page', () => {
  beforeEach(() => {
    mocks.svelteKitPage.url = new URL('http://localhost/repositories/1/issues');
    mocks.goto.mockReset();
  });

  afterEach(() => cleanup());

  it('shows the no-open-issues empty state when there are no filters applied', async () => {
    render(IssuesPage, { data: baseData });

    await expect
      .element(browserPage.getByRole('heading', { name: 'No open issues' }))
      .toBeVisible();
  });

  it('shows a filtered empty state when filters are active and no rows match', async () => {
    render(IssuesPage, {
      data: { ...baseData, filters: { ...baseData.filters, state: 'closed' } },
    });

    await expect
      .element(browserPage.getByRole('heading', { name: 'No issues match these filters' }))
      .toBeVisible();
  });

  it('renders issue rows with number, title, author, labels, assignees, and comment count', async () => {
    render(IssuesPage, { data: { ...baseData, issues: [sampleIssue] } });

    await expect
      .element(browserPage.getByRole('link', { name: 'Widget crashes on load' }))
      .toBeVisible();
    await expect.element(browserPage.getByText('#42')).toBeVisible();
    await expect.element(browserPage.getByRole('link', { name: 'octocat' })).toBeVisible();
    await expect.element(browserPage.getByText('bug')).toBeVisible();
    await expect.element(browserPage.getByText('hubot')).toBeVisible();
    await expect.element(browserPage.getByRole('cell', { name: '3', exact: true })).toBeVisible();
  });

  it('shows an honest, non-exact issue count summary', async () => {
    render(IssuesPage, { data: { ...baseData, issues: [sampleIssue] } });

    await expect.element(browserPage.getByText('Showing 1 open issue')).toBeVisible();
  });

  it('shows pagination even when the current page has zero issues but a next page exists', async () => {
    // GitHub paginates before pull requests are filtered out of the issues
    // response, so an empty-looking page can still have real issues later on.
    render(IssuesPage, {
      data: { ...baseData, issues: [], hasNextPage: true },
    });

    await expect.element(browserPage.getByRole('navigation', { name: 'Pagination' })).toBeVisible();
  });

  it('does not claim there are no open issues when a filled-with-PRs page still has a next page', async () => {
    // A page can be entirely pull requests (filtered out client-side) while
    // hasNextPage is still true — telling the user "No open issues" here is
    // misleading since the next page can contain real issues.
    render(IssuesPage, {
      data: { ...baseData, issues: [], hasNextPage: true },
    });

    await expect
      .element(browserPage.getByRole('heading', { name: 'No issues on this page' }))
      .toBeVisible();
    await expect
      .element(browserPage.getByRole('heading', { name: 'No open issues' }))
      .not.toBeInTheDocument();
  });

  it('tells the user the page is empty (not that there are no open issues) on an empty later page', async () => {
    // A bookmarked/shared URL such as ?issue_page=3 can point past the last
    // page of results after issues are closed or deleted. hasNextPage is
    // false here, but filters.page > 1, so the copy should not claim the
    // repository has no open issues — it should say this page is empty.
    render(IssuesPage, {
      data: {
        ...baseData,
        issues: [],
        hasNextPage: false,
        filters: { ...baseData.filters, page: 3 },
      },
    });

    await expect
      .element(browserPage.getByRole('heading', { name: 'This page is empty' }))
      .toBeVisible();
    await expect
      .element(browserPage.getByRole('heading', { name: 'No open issues' }))
      .not.toBeInTheDocument();
  });

  it('shows the next-page copy (not the filtered no-match copy) when filters are active and the page is filled with pull requests', async () => {
    // GitHub paginates issues before filtering out pull requests, so a
    // filtered page can come back with zero issues while a later page still
    // has matches. hasNextPage must win over isFiltered in the empty state.
    render(IssuesPage, {
      data: {
        ...baseData,
        issues: [],
        hasNextPage: true,
        filters: { ...baseData.filters, state: 'closed' },
      },
    });

    await expect
      .element(browserPage.getByRole('heading', { name: 'No issues on this page' }))
      .toBeVisible();
    await expect
      .element(browserPage.getByRole('heading', { name: 'No issues match these filters' }))
      .not.toBeInTheDocument();
  });

  it('tells the user the page is empty (not that filters have no matches) on an out-of-range filtered page', async () => {
    // A bookmarked/shared filtered URL such as ?issue_state=closed&issue_page=3
    // can point past the last page for that filter. The Previous control still
    // renders and earlier pages may have matches, so this should read as an
    // out-of-range page, not as "filters have no matches".
    render(IssuesPage, {
      data: {
        ...baseData,
        issues: [],
        hasNextPage: false,
        filters: { ...baseData.filters, state: 'closed', page: 3 },
      },
    });

    await expect
      .element(browserPage.getByRole('heading', { name: 'This page is empty' }))
      .toBeVisible();
    await expect
      .element(browserPage.getByRole('heading', { name: 'No issues match these filters' }))
      .not.toBeInTheDocument();
  });

  it('navigates with the state filter and resets to page 1 when a facet changes', async () => {
    render(IssuesPage, {
      data: { ...baseData, filters: { ...baseData.filters, page: 3 } },
    });

    const stateSelect = browserPage.getByLabelText('State');
    await stateSelect.selectOptions('closed');

    expect(mocks.goto).toHaveBeenCalledWith(
      expect.stringContaining('issue_state=closed'),
      expect.objectContaining({ invalidateAll: true }),
    );
    expect(mocks.goto).toHaveBeenCalledWith(
      expect.stringContaining('issue_page=1'),
      expect.anything(),
    );
  });

  it('cancels a pending label debounce when another facet changes first, instead of firing later and dropping it', async () => {
    // Typing in the label box starts a 400ms debounce. If the state facet
    // changes before that timer fires, the debounce must not go on to build a
    // URL from the (still pre-navigation) page.url and silently overwrite the
    // facet change that was just navigated to.
    vi.useFakeTimers();
    try {
      render(IssuesPage, { data: baseData });

      const labelsInput = browserPage.getByLabelText('Labels');
      await labelsInput.fill('bug');

      const stateSelect = browserPage.getByLabelText('State');
      await stateSelect.selectOptions('closed');

      expect(mocks.goto).toHaveBeenCalledTimes(1);
      expect(mocks.goto).toHaveBeenCalledWith(
        expect.stringContaining('issue_state=closed'),
        expect.anything(),
      );

      await vi.advanceTimersByTimeAsync(400);

      // The label debounce must have been cancelled by the facet change, so
      // no second navigation fires and clobbers it.
      expect(mocks.goto).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
