import { error, redirect } from '@sveltejs/kit';
import {
  getRepositoryById,
  getInstallationForRepository,
} from '@tribunal/github/repositories/service';
import { listPullRequests } from '@tribunal/github/pull-requests/service';
import type { PullRequestFilterOptions } from '@tribunal/github/types/pull-requests';
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

  return {
    repository: {
      id: repository.id,
      owner: repository.owner,
      name: repository.name,
    },
    pullRequests: result.pullRequests.map((pullRequest) => ({
      number: pullRequest.number,
      title: pullRequest.title,
      draft: pullRequest.draft,
      htmlUrl: pullRequest.htmlUrl,
      headRef: pullRequest.headRef,
      baseRef: pullRequest.baseRef,
      updatedAt: pullRequest.updatedAt,
      author: pullRequest.author
        ? { login: pullRequest.author.login, htmlUrl: pullRequest.author.htmlUrl }
        : null,
    })),
  };
};
