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
});
