import { error, redirect } from '@sveltejs/kit';
import {
  getRepositoryById,
  getInstallationForRepository,
} from '@tribunal/github/repositories/service';
import { listIssues, parseIssueFilters } from '@tribunal/github/issues/service';
import { isOctokitRequestError, isRateLimitError, isNotFoundError } from '@tribunal/github/errors';
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
  ).catch((cause: unknown) => {
    // GitHub's "List repository issues" endpoint requires the app's
    // installation to have accepted the "Issues" repository permission
    // (separate from "Pull requests"). Installations that predate that
    // permission request 403 here rather than returning PR-only rows.
    if (isOctokitRequestError(cause) && cause.status === 403 && !isRateLimitError(cause)) {
      error(
        403,
        'This GitHub App installation needs the "Issues" permission to show repository issues. Ask an installation owner to accept the updated permissions request on GitHub, then reload this page.',
      );
    }
    // GitHub returns 410 Gone for "List repository issues" when the
    // repository has the Issues feature disabled entirely.
    // https://docs.github.com/en/rest/issues/issues#list-repository-issues
    if (isOctokitRequestError(cause) && cause.status === 410) {
      error(410, 'Issues are disabled for this repository.');
    }
    // GitHub returns 404 here when the local repository/installation rows are
    // stale relative to GitHub (repository deleted, transferred, or the app
    // lost access since we last synced). Treat it the same as the
    // repository/access checks above rather than surfacing a generic 500.
    if (isNotFoundError(cause)) {
      error(404, 'Repository not found');
    }
    throw cause;
  });

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
