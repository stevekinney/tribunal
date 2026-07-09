import { error, redirect } from '@sveltejs/kit';
import { getRepositoryById } from '@tribunal/github/repositories/service';
import { githubContext } from '$lib/server/github-context';
import { userCanAccessRepository } from '$lib/server/repositories';
import {
  getWebhookEventFilterOptions,
  listWebhookEvents,
  parseWebhookEventFilters,
} from '$lib/server/webhook-events';
import type { PageServerLoad } from './$types';

/**
 * Lists webhook events for a single repository the user can access through
 * one of their GitHub App installations. 404s (matching the pull request
 * route's authorization pattern) when the repository does not exist or the
 * user cannot reach it.
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

  const canAccess = await userCanAccessRepository(user.id, repositoryId);
  if (!canAccess) {
    error(404, 'Repository not found');
  }

  const filters = parseWebhookEventFilters(url);

  const [eventsResult, filterOptions] = await Promise.all([
    listWebhookEvents([repositoryId], filters, repositoryId),
    getWebhookEventFilterOptions([repositoryId], repositoryId),
  ]);

  return {
    repository: {
      id: repository.id,
      owner: repository.owner,
      name: repository.name,
    },
    events: eventsResult.events,
    page: eventsResult.page,
    perPage: eventsResult.perPage,
    totalCount: eventsResult.totalCount,
    filters,
    filterOptions,
  };
};
