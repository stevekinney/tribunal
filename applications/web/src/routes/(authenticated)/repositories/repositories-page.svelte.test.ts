import { page } from 'vitest/browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import RepositoriesPage from './+page.svelte';
import type { PageData } from './$types';

const enhancedFormTesting = vi.hoisted(() => {
  function createDeferred() {
    let resolve!: () => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<void>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });
    return { promise, reject, resolve };
  }

  return {
    submissions: [] as Array<{
      formData: FormData;
      resolveResult: () => void;
      rejectUpdate: (reason?: unknown) => void;
      resolveUpdate: () => void;
    }>,
    createDeferred,
    reset() {
      this.submissions.length = 0;
    },
  };
});

vi.mock('$app/forms', () => ({
  enhance: (
    formElement: HTMLFormElement,
    submitFunction?: (input: {
      action: URL;
      cancel: () => void;
      formData: FormData;
      formElement: HTMLFormElement;
      submitter: SubmitEvent['submitter'];
    }) =>
      | void
      | ((input: {
          action: URL;
          formData: FormData;
          formElement: HTMLFormElement;
          result: { type: 'success'; status: 200; data: Record<string, never> };
          update: () => Promise<void>;
        }) => Promise<void>),
  ) => {
    const handleSubmit = async (event: SubmitEvent) => {
      event.preventDefault();

      const formData = new FormData(formElement);
      const action = new URL(
        formElement.getAttribute('action') ?? '.',
        'http://localhost/repositories',
      );
      const resultHandler = submitFunction?.({
        action,
        cancel: () => {},
        formData,
        formElement,
        submitter: event.submitter,
      });
      const deferredResult = enhancedFormTesting.createDeferred();
      const deferredUpdate = enhancedFormTesting.createDeferred();
      enhancedFormTesting.submissions.push({
        formData,
        resolveResult: deferredResult.resolve,
        rejectUpdate: deferredUpdate.reject,
        resolveUpdate: deferredUpdate.resolve,
      });

      void deferredResult.promise
        .then(() => {
          if (typeof resultHandler !== 'function') return;
          return resultHandler({
            action,
            formData,
            formElement,
            result: { type: 'success', status: 200, data: {} },
            update: () => deferredUpdate.promise,
          });
        })
        .catch(() => {});
    };

    formElement.addEventListener('submit', handleSubmit);
    return {
      destroy() {
        formElement.removeEventListener('submit', handleSubmit);
      },
    };
  },
}));

type RepositoryRow = PageData['repositories'][number];
type DashboardRow = NonNullable<RepositoryRow['dashboard']>;

function makeDashboardRow(overrides: Partial<DashboardRow> = {}): DashboardRow {
  return {
    repository: { id: 101, owner: 'test-org', name: 'review-target', defaultBranch: 'main' },
    defaultBranchStatus: 'passing',
    openPullRequestCount: 2,
    openPullRequestCountAtCap: false,
    attentionPullRequestCount: 0,
    unresolvedThreadCount: 0,
    pullRequests: [],
    refreshedAt: '2026-07-09T00:00:00.000Z',
    dataStatus: 'ok',
    ...overrides,
  };
}

function makeRepository(overrides: Partial<RepositoryRow> = {}): RepositoryRow {
  return {
    id: 101,
    owner: 'test-org',
    name: 'review-target',
    defaultBranch: 'main',
    accountLogin: 'test-org',
    accountAvatarUrl: null,
    review: {
      hasSavedSettings: false,
      watched: false,
      lastRunStatus: null,
      estimatedCostLast30DaysUsd: 0,
      ignoreGlobs: [],
      agents: [],
    },
    dashboard: makeDashboardRow(),
    ...overrides,
  };
}

const okSummaryForOne = {
  totalRepositoryCount: 1,
  failingDefaultBranchCount: 0,
  failingDefaultBranchCountExact: true,
  openPullRequestCount: 2,
  openPullRequestCountExact: true,
  attentionPullRequestCount: 0,
  attentionPullRequestCountExact: true,
  hasUnavailableRepositories: false,
} satisfies PageData['summary'];

const baseData = {
  user: {
    id: 1,
    username: 'testuser',
    name: 'Test User',
    avatarUrl: null,
    email: 'test@example.com',
    isPlatformAdministrator: false,
  },
  repositories: [],
  agents: [],
  installations: [],
  summary: null,
  attentionPullRequests: [],
  needsConnect: false,
  loadError: null,
  surfaceStates: ['empty', 'loading', 'streaming', 'success', 'error', 'disconnected'],
  reviewsEnabled: false,
} satisfies PageData;

describe('/repositories page', () => {
  beforeEach(() => {
    enhancedFormTesting.reset();
  });

  it('prompts users to install the GitHub App when no installation exists', async () => {
    render(RepositoriesPage, { data: baseData, form: null, params: {} });

    await expect
      .element(page.getByRole('heading', { name: 'Install the GitHub App' }))
      .toBeInTheDocument();
    await expect
      .element(page.getByRole('link', { name: 'Install Tribunal' }))
      .toHaveAttribute('href', '/connect/github');
  });

  it('shows an empty state when an installation exists but no repositories are synced yet', async () => {
    render(RepositoriesPage, {
      data: {
        ...baseData,
        installations: [
          { installationId: 12345, accountLogin: 'test-org', accountAvatarUrl: null },
        ],
        summary: {
          totalRepositoryCount: 0,
          failingDefaultBranchCount: 0,
          failingDefaultBranchCountExact: true,
          openPullRequestCount: 0,
          openPullRequestCountExact: true,
          attentionPullRequestCount: 0,
          attentionPullRequestCountExact: true,
          hasUnavailableRepositories: false,
        },
      },
      form: null,
      params: {},
    });

    await expect.element(page.getByText('No repositories found')).toBeInTheDocument();
  });

  it('renders the summary strip and repository health table for a healthy repository', async () => {
    render(RepositoriesPage, {
      data: {
        ...baseData,
        installations: [
          { installationId: 12345, accountLogin: 'test-org', accountAvatarUrl: null },
        ],
        repositories: [makeRepository()],
        summary: {
          totalRepositoryCount: 1,
          failingDefaultBranchCount: 0,
          failingDefaultBranchCountExact: true,
          openPullRequestCount: 2,
          openPullRequestCountExact: true,
          attentionPullRequestCount: 0,
          attentionPullRequestCountExact: true,
          hasUnavailableRepositories: false,
        },
      },
      form: null,
      params: {},
    });

    await expect.element(page.getByText('Passing')).toBeInTheDocument();
    await expect
      .element(page.getByRole('link', { name: '2' }))
      .toHaveAttribute('href', '/repositories/101/pull-requests');
    await expect
      .element(page.getByText('No open pull requests need attention right now.'))
      .toBeInTheDocument();
  });

  it('renders an attention pull request in the cross-repository list', async () => {
    render(RepositoriesPage, {
      data: {
        ...baseData,
        installations: [
          { installationId: 12345, accountLogin: 'test-org', accountAvatarUrl: null },
        ],
        repositories: [
          makeRepository({
            dashboard: makeDashboardRow({ attentionPullRequestCount: 1, unresolvedThreadCount: 3 }),
          }),
        ],
        attentionPullRequests: [
          {
            repositoryId: 101,
            number: 42,
            title: 'Fix flaky test',
            htmlUrl: 'https://github.com/test-org/review-target/pull/42',
            author: { login: 'octocat', htmlUrl: 'https://github.com/octocat' },
            draft: false,
            headRef: 'fix-flaky-test',
            baseRef: 'main',
            headSha: 'abc123',
            ciStatus: 'failing',
            ciUpdatedAt: '2026-07-09T00:00:00.000Z',
            mergeStatus: 'conflicts',
            mergeUpdatedAt: '2026-07-09T00:00:00.000Z',
            unresolvedThreadCount: 3,
            reviewUpdatedAt: '2026-07-09T00:00:00.000Z',
            updatedAt: '2026-07-09T00:00:00.000Z',
            repositoryOwner: 'test-org',
            repositoryName: 'review-target',
          },
        ],
        summary: {
          totalRepositoryCount: 1,
          failingDefaultBranchCount: 0,
          failingDefaultBranchCountExact: true,
          openPullRequestCount: 2,
          openPullRequestCountExact: true,
          attentionPullRequestCount: 1,
          attentionPullRequestCountExact: true,
          hasUnavailableRepositories: false,
        },
      },
      form: null,
      params: {},
    });

    await expect
      .element(page.getByRole('link', { name: /Fix flaky test/ }))
      .toHaveAttribute('href', 'https://github.com/test-org/review-target/pull/42');
    await expect.element(page.getByText('test-org/review-target').first()).toBeInTheDocument();
    await expect.element(page.getByText('Failing', { exact: true })).toBeInTheDocument();
    await expect.element(page.getByText('Conflicts')).toBeInTheDocument();
    await expect.element(page.getByText('3 unresolved')).toBeInTheDocument();
  });

  it('renders unknown statuses and a partial-failure alert when GitHub data is unavailable', async () => {
    render(RepositoriesPage, {
      data: {
        ...baseData,
        installations: [
          { installationId: 12345, accountLogin: 'test-org', accountAvatarUrl: null },
        ],
        repositories: [
          makeRepository({
            dashboard: makeDashboardRow({
              dataStatus: 'unavailable',
              unavailableReason: 'rate-limited',
              defaultBranchStatus: 'unknown',
              openPullRequestCount: null,
              attentionPullRequestCount: null,
              unresolvedThreadCount: null,
            }),
          }),
        ],
        summary: {
          totalRepositoryCount: 1,
          failingDefaultBranchCount: 0,
          failingDefaultBranchCountExact: false,
          openPullRequestCount: 0,
          openPullRequestCountExact: false,
          attentionPullRequestCount: 0,
          attentionPullRequestCountExact: false,
          hasUnavailableRepositories: true,
        },
      },
      form: null,
      params: {},
    });

    await expect.element(page.getByText(/could not be refreshed this build/)).toBeInTheDocument();
    const unknownCells = page.getByText('Unknown');
    await expect.element(unknownCells.first()).toBeInTheDocument();
  });

  it('flags the "needs attention" empty state as partial when data is unavailable', async () => {
    render(RepositoriesPage, {
      data: {
        ...baseData,
        installations: [
          { installationId: 12345, accountLogin: 'test-org', accountAvatarUrl: null },
        ],
        repositories: [
          makeRepository({
            dashboard: makeDashboardRow({
              dataStatus: 'unavailable',
              unavailableReason: 'rate-limited',
              defaultBranchStatus: 'unknown',
              openPullRequestCount: null,
              attentionPullRequestCount: null,
              unresolvedThreadCount: null,
            }),
          }),
        ],
        attentionPullRequests: [],
        summary: {
          totalRepositoryCount: 1,
          failingDefaultBranchCount: 0,
          failingDefaultBranchCountExact: false,
          openPullRequestCount: 0,
          openPullRequestCountExact: false,
          attentionPullRequestCount: 0,
          attentionPullRequestCountExact: false,
          hasUnavailableRepositories: true,
        },
      },
      form: null,
      params: {},
    });

    // Regression: an empty attentionPullRequests list can mean "nothing needs
    // attention" or "some repositories were never inspected" (rate limit,
    // budget exhaustion, no installation, GitHub error). These must not read
    // the same to the user.
    await expect.element(page.getByText(/Attention data is incomplete/)).toBeInTheDocument();
    await expect
      .element(page.getByText('No open pull requests need attention right now.'))
      .not.toBeInTheDocument();
  });

  it('marks the failing default branch stat as partial when data is unavailable', async () => {
    render(RepositoriesPage, {
      data: {
        ...baseData,
        installations: [
          { installationId: 12345, accountLogin: 'test-org', accountAvatarUrl: null },
        ],
        repositories: [
          makeRepository({
            dashboard: makeDashboardRow({
              dataStatus: 'unavailable',
              unavailableReason: 'rate-limited',
              defaultBranchStatus: 'unknown',
              openPullRequestCount: null,
              attentionPullRequestCount: null,
              unresolvedThreadCount: null,
            }),
          }),
        ],
        summary: {
          totalRepositoryCount: 1,
          failingDefaultBranchCount: 0,
          failingDefaultBranchCountExact: false,
          openPullRequestCount: 0,
          openPullRequestCountExact: false,
          attentionPullRequestCount: 0,
          attentionPullRequestCountExact: false,
          hasUnavailableRepositories: true,
        },
      },
      form: null,
      params: {},
    });

    // Regression: a repository that was never checked contributes 0 to
    // failingDefaultBranchCount, so an exact "0" is indistinguishable from
    // "we confirmed zero repositories are failing." Mark it partial instead.
    await expect
      .element(page.getByLabelText('Failing default branch').getByText('0+', { exact: true }))
      .toBeInTheDocument();
  });

  it('caps the open pull request count display at the 100-item page cap', async () => {
    render(RepositoriesPage, {
      data: {
        ...baseData,
        installations: [
          { installationId: 12345, accountLogin: 'test-org', accountAvatarUrl: null },
        ],
        repositories: [
          makeRepository({
            dashboard: makeDashboardRow({
              openPullRequestCount: 100,
              openPullRequestCountAtCap: true,
            }),
          }),
        ],
        summary: {
          totalRepositoryCount: 1,
          failingDefaultBranchCount: 0,
          failingDefaultBranchCountExact: true,
          openPullRequestCount: 100,
          openPullRequestCountExact: false,
          attentionPullRequestCount: 0,
          attentionPullRequestCountExact: false,
          hasUnavailableRepositories: false,
        },
      },
      form: null,
      params: {},
    });

    await expect.element(page.getByRole('link', { name: '100+' })).toBeInTheDocument();
    await expect.element(page.getByText('100+', { exact: true }).first()).toBeInTheDocument();
  });

  // Regression: when a repository hits the 100-item pull request page cap,
  // unresolvedThreadCount is only summed from the fetched PRs, so older
  // unfetched PRs could still have unresolved threads. Mark it partial with
  // the same "+" convention used for open PRs and attention counts.
  it('marks the unresolved thread count as partial when the open pull request cap is hit', async () => {
    render(RepositoriesPage, {
      data: {
        ...baseData,
        installations: [
          { installationId: 12345, accountLogin: 'test-org', accountAvatarUrl: null },
        ],
        repositories: [
          makeRepository({
            dashboard: makeDashboardRow({
              openPullRequestCount: 100,
              openPullRequestCountAtCap: true,
              unresolvedThreadCount: 5,
            }),
          }),
        ],
        summary: {
          totalRepositoryCount: 1,
          failingDefaultBranchCount: 0,
          failingDefaultBranchCountExact: true,
          openPullRequestCount: 100,
          openPullRequestCountExact: false,
          attentionPullRequestCount: 0,
          attentionPullRequestCountExact: false,
          hasUnavailableRepositories: false,
        },
      },
      form: null,
      params: {},
    });

    await expect.element(page.getByText('5+', { exact: true })).toBeInTheDocument();
  });

  it('filters the add-repository combobox by owner, name, and owner/name', async () => {
    render(RepositoriesPage, {
      data: {
        ...baseData,
        installations: [
          { installationId: 12345, accountLogin: 'test-org', accountAvatarUrl: null },
        ],
        repositories: [
          makeRepository({
            id: 101,
            name: 'review-target',
            review: {
              hasSavedSettings: false,
              watched: false,
              lastRunStatus: null,
              estimatedCostLast30DaysUsd: 0,
              ignoreGlobs: [],
              agents: [],
            },
          }),
          makeRepository({
            id: 202,
            owner: 'other-org',
            name: 'widgets',
            dashboard: makeDashboardRow({
              repository: { id: 202, owner: 'other-org', name: 'widgets', defaultBranch: 'main' },
            }),
            review: {
              hasSavedSettings: false,
              watched: false,
              lastRunStatus: null,
              estimatedCostLast30DaysUsd: 0,
              ignoreGlobs: [],
              agents: [],
            },
          }),
        ],
        summary: {
          totalRepositoryCount: 2,
          failingDefaultBranchCount: 0,
          failingDefaultBranchCountExact: true,
          openPullRequestCount: 4,
          openPullRequestCountExact: true,
          attentionPullRequestCount: 0,
          attentionPullRequestCountExact: true,
          hasUnavailableRepositories: false,
        },
      },
      form: null,
      params: {},
    });

    const combobox = page.getByRole('combobox', { name: 'Add repository' });
    const addButton = page.getByRole('button', { name: 'Add' });

    await expect.element(addButton).toBeDisabled();

    await combobox.fill('other-org/widgets');
    await expect
      .element(page.getByRole('option', { name: /other-org\/widgets/ }))
      .toBeInTheDocument();
    await page.getByRole('option', { name: /other-org\/widgets/ }).click();

    await expect.element(addButton).not.toBeDisabled();

    await addButton.click();

    expect(enhancedFormTesting.submissions).toHaveLength(1);
    expect(enhancedFormTesting.submissions[0]?.formData.get('repositoryId')).toBe('202');
    expect(enhancedFormTesting.submissions[0]?.formData.get('watched')).toBe('on');

    enhancedFormTesting.submissions[0]?.resolveResult();
    enhancedFormTesting.submissions[0]?.resolveUpdate();

    await expect.element(combobox).toHaveValue('');
  });

  it('shows a "No results" message when no repository matches the typed text', async () => {
    render(RepositoriesPage, {
      data: {
        ...baseData,
        installations: [
          { installationId: 12345, accountLogin: 'test-org', accountAvatarUrl: null },
        ],
        repositories: [
          makeRepository({
            review: {
              hasSavedSettings: false,
              watched: false,
              lastRunStatus: null,
              estimatedCostLast30DaysUsd: 0,
              ignoreGlobs: [],
              agents: [],
            },
          }),
        ],
        summary: {
          totalRepositoryCount: 1,
          failingDefaultBranchCount: 0,
          failingDefaultBranchCountExact: true,
          openPullRequestCount: 2,
          openPullRequestCountExact: true,
          attentionPullRequestCount: 0,
          attentionPullRequestCountExact: true,
          hasUnavailableRepositories: false,
        },
      },
      form: null,
      params: {},
    });

    const combobox = page.getByRole('combobox', { name: 'Add repository' });
    await combobox.fill('no-such-repository');

    await expect.element(page.getByText('No results')).toBeInTheDocument();
  });

  it('preserves saved repository settings when re-watching a repository', async () => {
    render(RepositoriesPage, {
      data: {
        ...baseData,
        agents: [
          {
            id: '1',
            userId: 1,
            slug: 'security',
            description: 'Security reviews',
            body: 'Review security risks.',
            model: 'gpt-5',
            effort: null,
            enabled: true,
            createdAt: new Date('2026-01-01T00:00:00Z'),
            updatedAt: new Date('2026-01-01T00:00:00Z'),
          },
          {
            id: '2',
            userId: 1,
            slug: 'documentation',
            description: 'Documentation reviews',
            body: 'Review documentation.',
            model: 'gpt-5',
            effort: null,
            enabled: true,
            createdAt: new Date('2026-01-01T00:00:00Z'),
            updatedAt: new Date('2026-01-01T00:00:00Z'),
          },
        ],
        installations: [
          { installationId: 12345, accountLogin: 'test-org', accountAvatarUrl: null },
        ],
        repositories: [
          makeRepository({
            review: {
              hasSavedSettings: true,
              watched: false,
              lastRunStatus: null,
              estimatedCostLast30DaysUsd: 0,
              ignoreGlobs: ['generated/**', 'vendor/**'],
              agents: [{ id: '2', slug: 'documentation', enabled: true }],
            },
          }),
        ],
        summary: {
          totalRepositoryCount: 1,
          failingDefaultBranchCount: 0,
          failingDefaultBranchCountExact: true,
          openPullRequestCount: 2,
          openPullRequestCountExact: true,
          attentionPullRequestCount: 0,
          attentionPullRequestCountExact: true,
          hasUnavailableRepositories: false,
        },
      },
      form: null,
      params: {},
    });

    await page.getByRole('switch', { name: 'Add repository' }).click();

    expect(enhancedFormTesting.submissions).toHaveLength(1);
    expect(enhancedFormTesting.submissions[0]?.formData.getAll('agentIds')).toEqual(['2']);
    expect(enhancedFormTesting.submissions[0]?.formData.get('ignoreGlobs')).toBe(
      'generated/**\nvendor/**',
    );
    expect(enhancedFormTesting.submissions[0]?.formData.get('watched')).toBe('on');
  });

  it('defaults first-time watched repositories to all enabled agents', async () => {
    render(RepositoriesPage, {
      data: {
        ...baseData,
        agents: [
          {
            id: '1',
            userId: 1,
            slug: 'security',
            description: 'Security reviews',
            body: 'Review security risks.',
            model: 'gpt-5',
            effort: null,
            enabled: true,
            createdAt: new Date('2026-01-01T00:00:00Z'),
            updatedAt: new Date('2026-01-01T00:00:00Z'),
          },
        ],
        installations: [
          { installationId: 12345, accountLogin: 'test-org', accountAvatarUrl: null },
        ],
        repositories: [
          makeRepository({
            review: {
              hasSavedSettings: false,
              watched: false,
              lastRunStatus: null,
              estimatedCostLast30DaysUsd: 0,
              ignoreGlobs: [],
              agents: [],
            },
          }),
        ],
        summary: {
          totalRepositoryCount: 1,
          failingDefaultBranchCount: 0,
          failingDefaultBranchCountExact: true,
          openPullRequestCount: 2,
          openPullRequestCountExact: true,
          attentionPullRequestCount: 0,
          attentionPullRequestCountExact: true,
          hasUnavailableRepositories: false,
        },
      },
      form: null,
      params: {},
    });

    await page.getByRole('switch', { name: 'Add repository' }).click();

    expect(enhancedFormTesting.submissions).toHaveLength(1);
    expect(enhancedFormTesting.submissions[0]?.formData.getAll('agentIds')).toEqual(['1']);
    expect(enhancedFormTesting.submissions[0]?.formData.get('watched')).toBe('on');
  });

  it('queues rapid watch re-toggles so the final submitted state wins', async () => {
    render(RepositoriesPage, {
      data: {
        ...baseData,
        installations: [
          { installationId: 12345, accountLogin: 'test-org', accountAvatarUrl: null },
        ],
        repositories: [
          makeRepository({
            review: {
              hasSavedSettings: false,
              watched: false,
              lastRunStatus: null,
              estimatedCostLast30DaysUsd: 0,
              ignoreGlobs: [],
              agents: [],
            },
          }),
        ],
        summary: okSummaryForOne,
      },
      form: null,
      params: {},
    });

    const watchSwitch = page.getByRole('switch', { name: 'Add repository' });

    await watchSwitch.click();
    expect(enhancedFormTesting.submissions).toHaveLength(1);
    expect(enhancedFormTesting.submissions[0]?.formData.get('watched')).toBe('on');

    await page.getByRole('switch', { name: 'Remove repository' }).click();
    expect(enhancedFormTesting.submissions).toHaveLength(1);

    enhancedFormTesting.submissions[0]?.resolveResult();
    expect(enhancedFormTesting.submissions).toHaveLength(1);
    enhancedFormTesting.submissions[0]?.resolveUpdate();

    await expect.poll(() => enhancedFormTesting.submissions.length).toBe(2);
    expect(enhancedFormTesting.submissions[1]?.formData.get('watched')).toBe('');
  });

  it('allows watch toggles after an enhanced update rejects', async () => {
    render(RepositoriesPage, {
      data: {
        ...baseData,
        installations: [
          { installationId: 12345, accountLogin: 'test-org', accountAvatarUrl: null },
        ],
        repositories: [
          makeRepository({
            review: {
              hasSavedSettings: false,
              watched: false,
              lastRunStatus: null,
              estimatedCostLast30DaysUsd: 0,
              ignoreGlobs: [],
              agents: [],
            },
          }),
        ],
        summary: okSummaryForOne,
      },
      form: null,
      params: {},
    });

    await page.getByRole('switch', { name: 'Add repository' }).click();
    expect(enhancedFormTesting.submissions).toHaveLength(1);

    enhancedFormTesting.submissions[0]?.resolveResult();
    enhancedFormTesting.submissions[0]?.rejectUpdate(new Error('Network failed'));

    await expect.element(page.getByRole('switch', { name: 'Add repository' })).toBeVisible();

    await page.getByRole('switch', { name: 'Add repository' }).click();
    await expect.poll(() => enhancedFormTesting.submissions.length).toBe(2);
    expect(enhancedFormTesting.submissions[1]?.formData.get('watched')).toBe('on');
  });
});
