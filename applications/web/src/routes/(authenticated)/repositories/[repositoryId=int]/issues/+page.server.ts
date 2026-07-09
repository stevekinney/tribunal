import { error, redirect } from '@sveltejs/kit';
import {
  getRepositoryById,
  getInstallationForRepository,
} from '@tribunal/github/repositories/service';
import { listIssues, parseIssueFilters } from '@tribunal/github/issues/service';
import { githubContext } from '$lib/server/github-context';
import { userCanAccessRepository } from '$lib/server/repositories';
import type { PageServerLoad } from './$types';

/**
 * Lists repository issues (pull requests excluded) for a single repository the
 * user can access through one of their GitHub App installations.
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

  const filters = parseIssueFilters(url);

  const installation = await getInstallationForRepository(githubContext, repositoryId);
  if (!installation.ok) {
    error(502, `Could not reach GitHub for this repository: ${installation.error}`);
  }

  const result = await listIssues(
    githubContext,
    installation.octokit,
    installation.owner,
    installation.repo,
    filters,
    repositoryId,
  );

  return {
    repository: {
      id: repository.id,
      owner: repository.owner,
      name: repository.name,
    },
    issues: result.issues,
    filters: result.filters,
    hasNextPage: result.hasNextPage,
  };
};
