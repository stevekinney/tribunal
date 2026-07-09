import { error, redirect } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { and, desc, eq } from 'drizzle-orm';
import { reviewRun } from '@tribunal/database/schema';
import {
  getRepositoryById,
  getInstallationForRepository,
} from '@tribunal/github/repositories/service';
import {
  getPullRequestOperationalStatus,
  listPullRequests,
} from '@tribunal/github/pull-requests/service';
import type { PullRequestFilterOptions } from '@tribunal/github/types/pull-requests';
import type { PullRequestOperationalStatus } from '@tribunal/github/types/pull-requests';
import { db } from '$lib/server/database';
import { githubContext } from '$lib/server/github-context';
import { userCanAccessRepository } from '$lib/server/repositories';
import type { PageServerLoad } from './$types';

/** Always list OPEN pull requests, most recently updated first. */
const OPEN_PULL_REQUEST_FILTERS: PullRequestFilterOptions = {
  state: 'open',
  sort: 'updated',
  direction: 'desc',
  page: 1,
  perPage: 50,
};
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

async function listE2EPullRequests(
  userId: number,
  repository: { id: number; owner: string; name: string },
) {
  const rows = await db
    .select()
    .from(reviewRun)
    .where(and(eq(reviewRun.userId, userId), eq(reviewRun.repositoryId, repository.id)))
    .orderBy(desc(reviewRun.startedAt), desc(reviewRun.id));

  const seenPullRequestNumbers = new Set<number>();
  return rows
    .filter((run) => {
      if (seenPullRequestNumbers.has(run.prNumber)) return false;
      seenPullRequestNumbers.add(run.prNumber);
      return true;
    })
    .map((run) => ({
      number: run.prNumber,
      title: `E2E pull request #${run.prNumber}`,
      draft: false,
      htmlUrl: `https://github.com/${repository.owner}/${repository.name}/pull/${run.prNumber}`,
      headRef: run.headSha,
      headSha: run.headSha,
      baseRef: 'main',
      updatedAt: (run.finishedAt ?? run.startedAt ?? new Date()).toISOString(),
      author: { login: 'e2e-contributor', htmlUrl: 'https://github.com/e2e-contributor' },
      status: statusForE2ERun(run.status),
    }));
}

/**
 * Lists OPEN pull requests for a single repository the user can access through
 * one of their GitHub App installations.
 */
export const load: PageServerLoad = async ({ params, locals }) => {
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

  const pullRequests = shouldUseE2EPullRequests()
    ? await listE2EPullRequests(user.id, repository)
    : await listLivePullRequests(repositoryId);

  return {
    repository: {
      id: repository.id,
      owner: repository.owner,
      name: repository.name,
    },
    pullRequests,
  };
};

async function listLivePullRequests(repositoryId: number) {
  const installation = await getInstallationForRepository(githubContext, repositoryId);
  if (!installation.ok) {
    error(502, `Could not reach GitHub for this repository: ${installation.error}`);
  }

  const result = await listPullRequests(
    githubContext,
    installation.octokit,
    installation.owner,
    installation.repo,
    OPEN_PULL_REQUEST_FILTERS,
    repositoryId,
  );

  return mapWithConcurrency(
    result.pullRequests,
    STATUS_LOOKUP_CONCURRENCY,
    async (pullRequest) => ({
      number: pullRequest.number,
      title: pullRequest.title,
      draft: pullRequest.draft,
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
