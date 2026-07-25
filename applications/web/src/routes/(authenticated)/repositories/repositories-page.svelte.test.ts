import { page } from 'vitest/browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
// Rendering a route component directly (rather than through the root
// `+layout.svelte`) skips `layout.css`, the only place Cinder's design tokens
// and `@layer` order get imported. Without it, the computed-style assertions
// below would see plain inherited typography regardless of whether Cinder's
// own component CSS landed. Scoped to this file (not `test/vitest.setup.ts`):
// per `.claude/rules/testing.md`, the shared setup file must not import
// modules with optional peer dependencies (cinder declares
// `@modelcontextprotocol/sdk` and `zod` as optional peers) because Vite
// resolves setup-file imports for every project up front, which would break
// test collection in a pruned/web-only install regardless of any runtime
// guard around the import.
import '@lostgradient/cinder/styles';
import RepositoriesPage from './+page.svelte';
import type { PageData } from './$types';

const invalidateAllMock = vi.hoisted(() => vi.fn());

vi.mock('$app/navigation', () => ({
  invalidateAll: invalidateAllMock,
}));

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
      updateCalled: boolean;
    }>,
    nextResultType: 'success' as 'success' | 'error',
    createDeferred,
    reset() {
      this.submissions.length = 0;
      this.nextResultType = 'success';
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
          result:
            | { type: 'success'; status: 200; data: Record<string, never> }
            | { type: 'error'; status?: number; error: unknown };
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
      const resultType = enhancedFormTesting.nextResultType;
      enhancedFormTesting.nextResultType = 'success';
      const submission = {
        formData,
        resolveResult: deferredResult.resolve,
        rejectUpdate: deferredUpdate.reject,
        resolveUpdate: deferredUpdate.resolve,
        updateCalled: false,
      };
      enhancedFormTesting.submissions.push(submission);

      void deferredResult.promise
        .then(() => {
          if (typeof resultHandler !== 'function') return;
          const result =
            resultType === 'error'
              ? ({ type: 'error', status: 500, error: new Error('boom') } as const)
              : ({ type: 'success', status: 200, data: {} } as const);
          return resultHandler({
            action,
            formData,
            formElement,
            result,
            update: () => {
              submission.updateCalled = true;
              return deferredUpdate.promise;
            },
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
type DashboardRow = Awaited<PageData['dashboardRowsById']> extends Map<number, infer V> ? V : never;
type Summary = Awaited<PageData['summary']>;
type AttentionPullRequestRow = Awaited<PageData['attentionPullRequests']>[number];

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

/** Builds the resolved `dashboardRowsById` map from a list of dashboard rows, keyed by repository id. */
function makeDashboardRowsById(rows: DashboardRow[]): Promise<Map<number, DashboardRow>> {
  return Promise.resolve(new Map(rows.map((row) => [row.repository.id, row])));
}

type AddableRepository = PageData['addableRepositories'][number];

// Repositories shown in the table are always added (watched); the picker below
// reads from a separate `addableRepositories` list, so table fixtures default
// to watched. Dashboard data is no longer carried on the row itself — it's
// looked up from the page-level `dashboardRowsById` map (see
// `makeDashboardRowsById`), matching the streamed shape `+page.server.ts` returns.
function makeRepository(overrides: Partial<RepositoryRow> = {}): RepositoryRow {
  return {
    id: 101,
    owner: 'test-org',
    name: 'review-target',
    defaultBranch: 'main',
    accountLogin: 'test-org',
    accountAvatarUrl: null,
    review: {
      hasSavedSettings: true,
      watched: true,
      lastRunStatus: null,
      estimatedCostLast30DaysUsd: 0,
      ignoreGlobs: [],
      agents: [],
    },
    ...overrides,
  };
}

function makeAddable(overrides: Partial<AddableRepository> = {}): AddableRepository {
  return {
    id: 202,
    owner: 'other-org',
    name: 'widgets',
    defaultBranch: 'main',
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
} satisfies Summary;

const baseData: PageData = {
  user: {
    id: 1,
    username: 'testuser',
    name: 'Test User',
    avatarUrl: null,
    email: 'test@example.com',
    isPlatformAdministrator: false,
  },
  repositories: [],
  addableRepositories: [],
  agents: [],
  installations: [],
  summary: Promise.resolve(null),
  attentionPullRequests: Promise.resolve([]),
  dashboardRowsById: Promise.resolve(new Map()),
  needsConnect: false,
  loadError: null,
  surfaceStates: ['empty', 'loading', 'streaming', 'success', 'error', 'disconnected'],
  reviewsEnabled: false,
};

describe('/repositories page', () => {
  beforeEach(() => {
    enhancedFormTesting.reset();
    invalidateAllMock.mockReset();
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

  it('shows an "add repositories" empty state when an installation exists but nothing is added yet', async () => {
    render(RepositoriesPage, {
      data: {
        ...baseData,
        installations: [
          { installationId: 12345, accountLogin: 'test-org', accountAvatarUrl: null },
        ],
        summary: Promise.resolve({
          totalRepositoryCount: 0,
          failingDefaultBranchCount: 0,
          failingDefaultBranchCountExact: true,
          openPullRequestCount: 0,
          openPullRequestCountExact: true,
          attentionPullRequestCount: 0,
          attentionPullRequestCountExact: true,
          hasUnavailableRepositories: false,
        }),
      },
      form: null,
      params: {},
    });

    await expect.element(page.getByText('No repositories added yet')).toBeInTheDocument();
  });

  it('renders the summary strip and repository health table for a healthy repository', async () => {
    render(RepositoriesPage, {
      data: {
        ...baseData,
        installations: [
          { installationId: 12345, accountLogin: 'test-org', accountAvatarUrl: null },
        ],
        repositories: [makeRepository()],
        dashboardRowsById: makeDashboardRowsById([makeDashboardRow()]),
        summary: Promise.resolve({
          totalRepositoryCount: 1,
          failingDefaultBranchCount: 0,
          failingDefaultBranchCountExact: true,
          openPullRequestCount: 2,
          openPullRequestCountExact: true,
          attentionPullRequestCount: 0,
          attentionPullRequestCountExact: true,
          hasUnavailableRepositories: false,
        }),
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

  it('renders StatGroup.Stat with its own typography, not unstyled text (cinder #905 regression)', async () => {
    render(RepositoriesPage, {
      data: {
        ...baseData,
        installations: [
          { installationId: 12345, accountLogin: 'test-org', accountAvatarUrl: null },
        ],
        repositories: [makeRepository()],
        summary: Promise.resolve({
          totalRepositoryCount: 1,
          failingDefaultBranchCount: 0,
          failingDefaultBranchCountExact: true,
          openPullRequestCount: 2,
          openPullRequestCountExact: true,
          attentionPullRequestCount: 0,
          attentionPullRequestCountExact: true,
          hasUnavailableRepositories: false,
        }),
      },
      form: null,
      params: {},
    });

    // The summary strip is behind `{#await data.summary}` (see
    // `+page.server.ts`) — wait for the StatGroup itself (rendered only in
    // the `{:then}` branch, via its `label` prop as an accessible group
    // name) to resolve before asserting on the Stat typography. A text
    // match on "Repositories" would be satisfied by the page's `<h1>`
    // immediately, without ever waiting on the resolved summary.
    await expect
      .element(page.getByRole('group', { name: 'Dashboard summary' }))
      .toBeInTheDocument();

    const label = document.querySelector('.cinder-stat__label');
    const value = document.querySelector('.cinder-stat__value');
    expect(label).not.toBeNull();
    expect(value).not.toBeNull();
    const labelFontSize = getComputedStyle(label as Element).fontSize;
    const valueFontSize = getComputedStyle(value as Element).fontSize;
    const valueFontWeight = getComputedStyle(value as Element).fontWeight;

    // Unstyled (bug) text runs would inherit identical, plain body typography.
    // A landed stat.css gives the label a small muted size and the value a
    // large, semibold one — so they must differ.
    expect(valueFontSize).not.toBe(labelFontSize);
    expect(Number.parseFloat(valueFontSize)).toBeGreaterThan(Number.parseFloat(labelFontSize));
    expect(Number.parseInt(valueFontWeight, 10)).toBeGreaterThanOrEqual(600);
  });

  it('wraps the repository table in a named, focusable scroll region', async () => {
    render(RepositoriesPage, {
      data: {
        ...baseData,
        installations: [
          { installationId: 12345, accountLogin: 'test-org', accountAvatarUrl: null },
        ],
        repositories: [makeRepository()],
        dashboardRowsById: makeDashboardRowsById([makeDashboardRow()]),
        summary: Promise.resolve({
          totalRepositoryCount: 1,
          failingDefaultBranchCount: 0,
          failingDefaultBranchCountExact: true,
          openPullRequestCount: 2,
          openPullRequestCountExact: true,
          attentionPullRequestCount: 0,
          attentionPullRequestCountExact: true,
          hasUnavailableRepositories: false,
        }),
      },
      form: null,
      params: {},
    });

    const scrollRegion = page.getByRole('region', { name: 'Repositories' });
    await expect.element(scrollRegion).toBeInTheDocument();
    await expect.element(scrollRegion).toHaveAttribute('tabindex', '0');
  });

  it('renders an attention pull request in the cross-repository list', async () => {
    render(RepositoriesPage, {
      data: {
        ...baseData,
        installations: [
          { installationId: 12345, accountLogin: 'test-org', accountAvatarUrl: null },
        ],
        repositories: [makeRepository()],
        dashboardRowsById: makeDashboardRowsById([
          makeDashboardRow({ attentionPullRequestCount: 1, unresolvedThreadCount: 3 }),
        ]),
        attentionPullRequests: Promise.resolve([
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
        ] satisfies AttentionPullRequestRow[]),
        summary: Promise.resolve({
          totalRepositoryCount: 1,
          failingDefaultBranchCount: 0,
          failingDefaultBranchCountExact: true,
          openPullRequestCount: 2,
          openPullRequestCountExact: true,
          attentionPullRequestCount: 1,
          attentionPullRequestCountExact: true,
          hasUnavailableRepositories: false,
        }),
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
        repositories: [makeRepository()],
        dashboardRowsById: makeDashboardRowsById([
          makeDashboardRow({
            dataStatus: 'unavailable',
            unavailableReason: 'rate-limited',
            defaultBranchStatus: 'unknown',
            openPullRequestCount: null,
            attentionPullRequestCount: null,
            unresolvedThreadCount: null,
          }),
        ]),
        summary: Promise.resolve({
          totalRepositoryCount: 1,
          failingDefaultBranchCount: 0,
          failingDefaultBranchCountExact: false,
          openPullRequestCount: 0,
          openPullRequestCountExact: false,
          attentionPullRequestCount: 0,
          attentionPullRequestCountExact: false,
          hasUnavailableRepositories: true,
        }),
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
        repositories: [makeRepository()],
        dashboardRowsById: makeDashboardRowsById([
          makeDashboardRow({
            dataStatus: 'unavailable',
            unavailableReason: 'rate-limited',
            defaultBranchStatus: 'unknown',
            openPullRequestCount: null,
            attentionPullRequestCount: null,
            unresolvedThreadCount: null,
          }),
        ]),
        attentionPullRequests: Promise.resolve([]),
        summary: Promise.resolve({
          totalRepositoryCount: 1,
          failingDefaultBranchCount: 0,
          failingDefaultBranchCountExact: false,
          openPullRequestCount: 0,
          openPullRequestCountExact: false,
          attentionPullRequestCount: 0,
          attentionPullRequestCountExact: false,
          hasUnavailableRepositories: true,
        }),
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
        repositories: [makeRepository()],
        dashboardRowsById: makeDashboardRowsById([
          makeDashboardRow({
            dataStatus: 'unavailable',
            unavailableReason: 'rate-limited',
            defaultBranchStatus: 'unknown',
            openPullRequestCount: null,
            attentionPullRequestCount: null,
            unresolvedThreadCount: null,
          }),
        ]),
        summary: Promise.resolve({
          totalRepositoryCount: 1,
          failingDefaultBranchCount: 0,
          failingDefaultBranchCountExact: false,
          openPullRequestCount: 0,
          openPullRequestCountExact: false,
          attentionPullRequestCount: 0,
          attentionPullRequestCountExact: false,
          hasUnavailableRepositories: true,
        }),
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
        repositories: [makeRepository()],
        dashboardRowsById: makeDashboardRowsById([
          makeDashboardRow({
            openPullRequestCount: 100,
            openPullRequestCountAtCap: true,
          }),
        ]),
        summary: Promise.resolve({
          totalRepositoryCount: 1,
          failingDefaultBranchCount: 0,
          failingDefaultBranchCountExact: true,
          openPullRequestCount: 100,
          openPullRequestCountExact: false,
          attentionPullRequestCount: 0,
          attentionPullRequestCountExact: false,
          hasUnavailableRepositories: false,
        }),
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
        repositories: [makeRepository()],
        dashboardRowsById: makeDashboardRowsById([
          makeDashboardRow({
            openPullRequestCount: 100,
            openPullRequestCountAtCap: true,
            unresolvedThreadCount: 5,
          }),
        ]),
        summary: Promise.resolve({
          totalRepositoryCount: 1,
          failingDefaultBranchCount: 0,
          failingDefaultBranchCountExact: true,
          openPullRequestCount: 100,
          openPullRequestCountExact: false,
          attentionPullRequestCount: 0,
          attentionPullRequestCountExact: false,
          hasUnavailableRepositories: false,
        }),
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
        summary: Promise.resolve(okSummaryForOne),
        addableRepositories: [
          makeAddable({ id: 101, owner: 'test-org', name: 'review-target' }),
          makeAddable({ id: 202, owner: 'other-org', name: 'widgets' }),
        ],
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

  it('does not call update() and keeps the combobox filled when the add-repository action errors', async () => {
    render(RepositoriesPage, {
      data: {
        ...baseData,
        installations: [
          { installationId: 12345, accountLogin: 'test-org', accountAvatarUrl: null },
        ],
        summary: Promise.resolve(okSummaryForOne),
        addableRepositories: [makeAddable({ id: 202, owner: 'other-org', name: 'widgets' })],
      },
      form: null,
      params: {},
    });

    const combobox = page.getByRole('combobox', { name: 'Add repository' });
    const addButton = page.getByRole('button', { name: 'Add' });

    await combobox.fill('other-org/widgets');
    await page.getByRole('option', { name: /other-org\/widgets/ }).click();
    await expect.element(addButton).not.toBeDisabled();

    enhancedFormTesting.nextResultType = 'error';
    await addButton.click();

    expect(enhancedFormTesting.submissions).toHaveLength(1);
    enhancedFormTesting.submissions[0]?.resolveResult();

    await expect.poll(() => enhancedFormTesting.submissions[0]?.updateCalled).toBe(false);
    await expect.element(combobox).toHaveValue('other-org/widgets');
  });

  it('shows a "No results" message when no repository matches the typed text', async () => {
    render(RepositoriesPage, {
      data: {
        ...baseData,
        installations: [
          { installationId: 12345, accountLogin: 'test-org', accountAvatarUrl: null },
        ],
        summary: Promise.resolve(okSummaryForOne),
        addableRepositories: [makeAddable({ id: 101, owner: 'test-org', name: 'review-target' })],
      },
      form: null,
      params: {},
    });

    const combobox = page.getByRole('combobox', { name: 'Add repository' });
    await combobox.fill('no-such-repository');

    await expect.element(page.getByText('No results')).toBeInTheDocument();
  });

  it('submits the row form with preserved agents and ignore globs when removing a repository', async () => {
    render(RepositoriesPage, {
      data: {
        ...baseData,
        installations: [
          { installationId: 12345, accountLogin: 'test-org', accountAvatarUrl: null },
        ],
        repositories: [
          makeRepository({
            review: {
              hasSavedSettings: true,
              watched: true,
              lastRunStatus: null,
              estimatedCostLast30DaysUsd: 0,
              ignoreGlobs: ['generated/**', 'vendor/**'],
              agents: [{ id: '2', slug: 'documentation', enabled: true }],
            },
          }),
        ],
        summary: Promise.resolve(okSummaryForOne),
      },
      form: null,
      params: {},
    });

    // The table only ever holds added repositories, so its toggle removes them —
    // and it submits the current agents/globs so a later re-add restores them.
    await page.getByRole('switch', { name: 'Repository watched' }).click();

    expect(enhancedFormTesting.submissions).toHaveLength(1);
    expect(enhancedFormTesting.submissions[0]?.formData.getAll('agentIds')).toEqual(['2']);
    expect(enhancedFormTesting.submissions[0]?.formData.get('ignoreGlobs')).toBe(
      'generated/**\nvendor/**',
    );
    expect(enhancedFormTesting.submissions[0]?.formData.get('watched')).toBe('');
  });

  it('queues rapid watch re-toggles so the final submitted state wins', async () => {
    render(RepositoriesPage, {
      data: {
        ...baseData,
        installations: [
          { installationId: 12345, accountLogin: 'test-org', accountAvatarUrl: null },
        ],
        repositories: [makeRepository()],
        summary: Promise.resolve(okSummaryForOne),
      },
      form: null,
      params: {},
    });

    await page.getByRole('switch', { name: 'Repository watched' }).click();
    expect(enhancedFormTesting.submissions).toHaveLength(1);
    expect(enhancedFormTesting.submissions[0]?.formData.get('watched')).toBe('');

    await page.getByRole('switch', { name: 'Repository watched' }).click();
    expect(enhancedFormTesting.submissions).toHaveLength(1);

    enhancedFormTesting.submissions[0]?.resolveResult();
    expect(enhancedFormTesting.submissions).toHaveLength(1);
    enhancedFormTesting.submissions[0]?.resolveUpdate();

    await expect.poll(() => enhancedFormTesting.submissions.length).toBe(2);
    expect(enhancedFormTesting.submissions[1]?.formData.get('watched')).toBe('on');
  });

  it('allows watch toggles after an enhanced update rejects', async () => {
    render(RepositoriesPage, {
      data: {
        ...baseData,
        installations: [
          { installationId: 12345, accountLogin: 'test-org', accountAvatarUrl: null },
        ],
        repositories: [makeRepository()],
        summary: Promise.resolve(okSummaryForOne),
      },
      form: null,
      params: {},
    });

    await page.getByRole('switch', { name: 'Repository watched' }).click();
    expect(enhancedFormTesting.submissions).toHaveLength(1);

    enhancedFormTesting.submissions[0]?.resolveResult();
    enhancedFormTesting.submissions[0]?.rejectUpdate(new Error('Network failed'));

    await expect.element(page.getByRole('switch', { name: 'Repository watched' })).toBeVisible();

    await page.getByRole('switch', { name: 'Repository watched' }).click();
    await expect.poll(() => enhancedFormTesting.submissions.length).toBe(2);
    expect(enhancedFormTesting.submissions[1]?.formData.get('watched')).toBe('');
  });

  it('shows a top-level alert when the page failed to load some data', async () => {
    render(RepositoriesPage, {
      data: { ...baseData, loadError: 'Could not reach GitHub. Showing cached data.' },
      form: null,
      params: {},
    });

    await expect
      .element(page.getByText('Could not reach GitHub. Showing cached data.'))
      .toBeVisible();
  });

  it('shows a top-level alert when the form action reports an error', async () => {
    render(RepositoriesPage, {
      data: baseData,
      form: { error: 'Could not add repository.' },
      params: {},
    });

    await expect.element(page.getByText('Could not add repository.')).toBeVisible();
  });

  it('filters the repository table by search query', async () => {
    render(RepositoriesPage, {
      data: {
        ...baseData,
        installations: [
          { installationId: 12345, accountLogin: 'test-org', accountAvatarUrl: null },
        ],
        repositories: [
          makeRepository(),
          makeRepository({ id: 202, owner: 'other-org', name: 'widgets' }),
        ],
        dashboardRowsById: makeDashboardRowsById([
          makeDashboardRow({
            repository: { id: 202, owner: 'other-org', name: 'widgets', defaultBranch: 'main' },
          }),
        ]),
        summary: Promise.resolve(okSummaryForOne),
      },
      form: null,
      params: {},
    });

    await page.getByRole('searchbox', { name: 'Search repositories' }).fill('widgets');

    await expect.element(page.getByText('other-org/widgets')).toBeInTheDocument();
    await expect.element(page.getByText('test-org/review-target')).not.toBeInTheDocument();
  });

  it('shows a no-matches hint when the search query matches no repository', async () => {
    render(RepositoriesPage, {
      data: {
        ...baseData,
        installations: [
          { installationId: 12345, accountLogin: 'test-org', accountAvatarUrl: null },
        ],
        repositories: [makeRepository()],
        summary: Promise.resolve(okSummaryForOne),
      },
      form: null,
      params: {},
    });

    await page.getByRole('searchbox', { name: 'Search repositories' }).fill('no-such-repo');

    await expect.element(page.getByText('No repositories matching "no-such-repo".')).toBeVisible();
  });

  it('renders the full range of attention CI and merge status badges', async () => {
    const attentionPullRequestBase = {
      repositoryId: 101,
      author: { login: 'octocat', htmlUrl: 'https://github.com/octocat' },
      draft: false,
      headRef: 'branch',
      baseRef: 'main',
      headSha: 'abc123',
      ciUpdatedAt: '2026-07-09T00:00:00.000Z',
      mergeUpdatedAt: '2026-07-09T00:00:00.000Z',
      unresolvedThreadCount: null,
      reviewUpdatedAt: '2026-07-09T00:00:00.000Z',
      updatedAt: '2026-07-09T00:00:00.000Z',
      repositoryOwner: 'test-org',
      repositoryName: 'review-target',
    };

    render(RepositoriesPage, {
      data: {
        ...baseData,
        installations: [
          { installationId: 12345, accountLogin: 'test-org', accountAvatarUrl: null },
        ],
        repositories: [makeRepository()],
        dashboardRowsById: makeDashboardRowsById([makeDashboardRow()]),
        summary: Promise.resolve(okSummaryForOne),
        attentionPullRequests: Promise.resolve([
          {
            ...attentionPullRequestBase,
            number: 1,
            title: 'Pending CI, blocked merge',
            htmlUrl: 'https://github.com/test-org/review-target/pull/1',
            ciStatus: 'pending',
            mergeStatus: 'blocked',
          },
          {
            ...attentionPullRequestBase,
            number: 2,
            title: 'Unknown CI, unknown merge',
            htmlUrl: 'https://github.com/test-org/review-target/pull/2',
            ciStatus: 'unknown',
            mergeStatus: 'unknown',
          },
          {
            ...attentionPullRequestBase,
            number: 3,
            title: 'Passing CI, clean merge',
            htmlUrl: 'https://github.com/test-org/review-target/pull/3',
            ciStatus: 'passing',
            mergeStatus: 'clean',
          },
        ] satisfies AttentionPullRequestRow[]),
      },
      form: null,
      params: {},
    });

    await expect.element(page.getByText('Pending', { exact: true })).toBeVisible();
    await expect.element(page.getByText('Blocked', { exact: true })).toBeVisible();
    await expect.element(page.getByText('Unknown', { exact: true }).first()).toBeVisible();
    await expect.element(page.getByText('Unresolved threads unknown').first()).toBeVisible();
    await expect.element(page.getByText('Passing', { exact: true }).nth(1)).toBeVisible();
    await expect.element(page.getByText('Mergeable')).toBeVisible();
  });

  it('prompts the user to connect GitHub before installing the app', async () => {
    render(RepositoriesPage, {
      data: { ...baseData, needsConnect: true },
      form: null,
      params: {},
    });

    await expect
      .element(page.getByRole('heading', { name: 'Connect GitHub to get started' }))
      .toBeVisible();
    await expect
      .element(page.getByRole('link', { name: 'Connect GitHub' }))
      .toHaveAttribute('href', '/connect/github/account');
  });

  it('falls back to a fetch-based watch submission and refreshes when the row form has been removed from the DOM', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    try {
      render(RepositoriesPage, {
        data: {
          ...baseData,
          installations: [
            { installationId: 12345, accountLogin: 'test-org', accountAvatarUrl: null },
          ],
          repositories: [
            makeRepository({
              review: {
                hasSavedSettings: true,
                watched: true,
                lastRunStatus: null,
                estimatedCostLast30DaysUsd: 0,
                ignoreGlobs: [],
                agents: [{ id: '1', slug: 'security', enabled: true }],
              },
            }),
          ],
          summary: Promise.resolve(okSummaryForOne),
        },
        form: null,
        params: {},
      });

      // First toggle starts a submission; the second (while it's in flight)
      // is queued instead of submitted immediately.
      await page.getByRole('switch', { name: 'Repository watched' }).click();
      await page.getByRole('switch', { name: 'Repository watched' }).click();
      expect(enhancedFormTesting.submissions).toHaveLength(1);

      // Filtering the table removes the row's form from the DOM before the
      // first submission settles, so the queued re-toggle can no longer find
      // it via document.getElementById and must fall back to a direct fetch.
      await page.getByRole('searchbox', { name: 'Search repositories' }).fill('no-match');

      enhancedFormTesting.submissions[0]?.resolveResult();
      enhancedFormTesting.submissions[0]?.resolveUpdate();

      await expect
        .poll(() => fetchMock)
        .toHaveBeenCalledWith('?/watch', expect.objectContaining({ method: 'POST' }));
      await expect.poll(() => invalidateAllMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
