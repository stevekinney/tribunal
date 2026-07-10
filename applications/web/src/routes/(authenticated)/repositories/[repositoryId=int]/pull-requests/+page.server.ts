import { error, fail, redirect } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { and, desc, eq } from 'drizzle-orm';
import { pullRequestReviewRun, tribunalRun } from '@tribunal/database/schema';
import {
  getRepositoryById,
  getInstallationForRepository,
} from '@tribunal/github/repositories/service';
import {
  getPullRequestOperationalStatus,
  listPullRequests,
  parsePullRequestFilters,
} from '@tribunal/github/pull-requests/service';
import type {
  PullRequestFilterOptions,
  PullRequestOperationalStatus,
} from '@tribunal/github/types/pull-requests';
import { db } from '$lib/server/database';
import { githubContext } from '$lib/server/github-context';
import { userCanAccessRepository } from '$lib/server/repositories';
import {
  getRepositoryOperatorDetails,
  listAgents,
  submitRepositorySettingsForm,
} from '$lib/server/review/operator';
import type { PageServerLoad } from './$types';
import type { Actions } from './$types';

const STATUS_LOOKUP_CONCURRENCY = 5;

function shouldUseE2EPullRequests(): boolean {
  return env.NODE_ENV !== 'production' && env.E2E_TEST_MODE === '1' && !!env.E2E_TEST_SECRET;
}

function statusForE2ERun(status: string): PullRequestOperationalStatus {
  return {
    ciStatus: status === 'failed' ? 'failing' : status === 'running' ? 'pending' : 'passing',
    checkCount: 1,
    resolvedReviewThreadCount: status === 'posted' ? 1 : 0,
    unresolvedReviewThreadCount: 0,
    mergeConflictStatus: 'clean',
    mergeableState: 'clean',
  };
}

interface E2EPullRequest {
  number: number;
  title: string;
  state: 'open' | 'closed';
  draft: boolean;
  mergedAt: string | null;
  htmlUrl: string;
  headRef: string;
  headSha: string;
  baseRef: string;
  updatedAt: string;
  author: { login: string; htmlUrl: string };
  status: PullRequestOperationalStatus;
}

/**
 * Synthesizes pull requests from `review_run` rows instead of calling
 * GitHub, for use in E2E test environments where GitHub cannot be reached.
 *
 * `review_run` has no genuine open/closed concept, so every synthesized
 * pull request is treated as open; a `closed`/`all` state filter narrows
 * the synthesized set rather than reflecting a real GitHub state. Sorting
 * only honors `updated` (the one timestamp the run data reliably carries)
 * and `direction`; `created`/`popularity`/`long-running` fall back to the
 * same `updated` ordering.
 */
async function listE2EPullRequests(
  userId: number,
  repository: { id: number; owner: string; name: string },
  filters: PullRequestFilterOptions,
): Promise<{ pullRequests: E2EPullRequest[]; hasNextPage: boolean }> {
  const rows = await db
    .select({ run: tribunalRun, review: pullRequestReviewRun })
    .from(tribunalRun)
    .innerJoin(pullRequestReviewRun, eq(pullRequestReviewRun.runId, tribunalRun.id))
    .where(
      and(eq(tribunalRun.userId, userId), eq(pullRequestReviewRun.repositoryId, repository.id)),
    )
    .orderBy(desc(tribunalRun.startedAt), desc(tribunalRun.id));

  const seenPullRequestNumbers = new Set<number>();
  let synthesized = rows
    .filter(({ review }) => {
      if (seenPullRequestNumbers.has(review.prNumber)) return false;
      seenPullRequestNumbers.add(review.prNumber);
      return true;
    })
    .map(
      ({ run, review }): E2EPullRequest => ({
        number: review.prNumber,
        title: `E2E pull request #${review.prNumber}`,
        state: 'open',
        draft: false,
        mergedAt: null,
        htmlUrl: `https://github.com/${repository.owner}/${repository.name}/pull/${review.prNumber}`,
        headRef: `e2e/pr-${review.prNumber}`,
        headSha: review.headSha,
        baseRef: 'main',
        updatedAt: (run.finishedAt ?? run.startedAt ?? new Date()).toISOString(),
        author: { login: 'e2e-contributor', htmlUrl: 'https://github.com/e2e-contributor' },
        status: statusForE2ERun(run.status),
      }),
    );

  if (filters.state === 'closed') {
    synthesized = [];
  }
  if (filters.head) {
    synthesized = synthesized.filter((pullRequest) => pullRequest.headRef === filters.head);
  }
  if (filters.base) {
    synthesized = synthesized.filter((pullRequest) => pullRequest.baseRef === filters.base);
  }

  synthesized.sort((a, b) => {
    const comparison = a.updatedAt < b.updatedAt ? -1 : a.updatedAt > b.updatedAt ? 1 : 0;
    return filters.direction === 'asc' ? comparison : -comparison;
  });

  const start = (filters.page - 1) * filters.perPage;
  const page = synthesized.slice(start, start + filters.perPage);

  return { pullRequests: page, hasNextPage: start + filters.perPage < synthesized.length };
}

/**
 * Lists pull requests for a single repository the user can access through
 * one of their GitHub App installations, filtered and paginated by the
 * `pr_*` URL contract (`parsePullRequestFilters`).
 */
export const load: PageServerLoad = async ({ params, locals, url }) => {
  const { user } = locals;
  if (!user) {
    redirect(302, '/login');
  }

  const repositoryId = Number(params.repositoryId);

  const repository = await getRepositoryById(githubContext, repositoryId);
  if (!repository) {
    error(404, 'Repository not found');
  }

  // Authorize: the user must reach this repository via one of their installations.
  const canAccess = await userCanAccessRepository(user.id, repositoryId);
  if (!canAccess) {
    error(404, 'Repository not found');
  }

  const filters = parsePullRequestFilters(url);

  // Legacy data shape: a tab still running the pre-move bundle (whose
  // component reads `data.repository.review` and `data.agents`) can trigger
  // an invalidateAll() after a successful legacy `?/saveSettings` submit (see
  // the `saveSettings` action below). That reruns this load with the OLD
  // component still mounted, so keep returning the fields it expects until
  // stale tabs from before the settings-page move are no longer a concern.
  const [operatorDetails, agents, { pullRequests, hasNextPage }] = await Promise.all([
    getRepositoryOperatorDetails(user.id, [repositoryId]),
    listAgents(user.id),
    shouldUseE2EPullRequests()
      ? listE2EPullRequests(user.id, repository, filters)
      : listLivePullRequests(repositoryId, filters),
  ]);

  return {
    repository: {
      id: repository.id,
      owner: repository.owner,
      name: repository.name,
      review: operatorDetails.get(repository.id) ?? {
        hasSavedSettings: false,
        watched: false,
        ignoreGlobs: [],
        agents: [],
        lastRunStatus: null,
        estimatedCostLast30DaysUsd: 0,
      },
    },
    agents,
    pullRequests,
    filters,
    hasNextPage,
  };
};

async function listLivePullRequests(repositoryId: number, filters: PullRequestFilterOptions) {
  const installation = await getInstallationForRepository(githubContext, repositoryId);
  if (!installation.ok) {
    error(502, `Could not reach GitHub for this repository: ${installation.error}`);
  }

  const result = await listPullRequests(
    githubContext,
    installation.octokit,
    installation.owner,
    installation.repo,
    filters,
    repositoryId,
  );

  // Operational status lookup only runs for the pull requests on this page —
  // GitHub has already paginated `result.pullRequests` to `filters.perPage`.
  const pullRequests = await mapWithConcurrency(
    result.pullRequests,
    STATUS_LOOKUP_CONCURRENCY,
    async (pullRequest) => ({
      number: pullRequest.number,
      title: pullRequest.title,
      state: pullRequest.state,
      draft: pullRequest.draft,
      mergedAt: pullRequest.mergedAt,
      htmlUrl: pullRequest.htmlUrl,
      headRef: pullRequest.headRef,
      headSha: pullRequest.headSha,
      baseRef: pullRequest.baseRef,
      updatedAt: pullRequest.updatedAt,
      author: pullRequest.author
        ? { login: pullRequest.author.login, htmlUrl: pullRequest.author.htmlUrl }
        : null,
      status: await getPullRequestOperationalStatus(
        githubContext,
        installation.octokit,
        installation.owner,
        installation.repo,
        pullRequest.number,
        pullRequest.headSha,
      ),
    }),
  );

  return { pullRequests, hasNextPage: result.hasNextPage };
}

async function mapWithConcurrency<T, U>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<U>,
): Promise<U[]> {
  const results: U[] = [];

  for (let index = 0; index < items.length; index += concurrency) {
    const chunk = items.slice(index, index + concurrency);
    results.push(...(await Promise.all(chunk.map(mapper))));
  }

  return results;
}

export const actions: Actions = {
  // Legacy action name: repository settings used to live on this page and
  // posted here. Kept so a tab still showing the pre-move UI at deploy time
  // (with the old settings form still rendered) saves successfully instead of
  // hitting a missing action and landing on +error.svelte. Settings now live
  // at /repositories/[repositoryId]/settings; remove this once stale tabs
  // from before that move are no longer a concern.
  saveSettings: async ({ locals, request, params }) => {
    const { user } = locals;
    if (!user) redirect(302, '/login');

    const repositoryId = Number(params.repositoryId);
    if (!Number.isInteger(repositoryId) || repositoryId <= 0) {
      return fail(400, { error: 'Repository is invalid.' });
    }

    const canAccess = await userCanAccessRepository(user.id, repositoryId);
    if (!canAccess) {
      error(404, 'Repository not found');
    }

    const formData = await request.formData();
    return submitRepositorySettingsForm(user.id, repositoryId, formData);
  },
};
