import { redirect } from '@sveltejs/kit';
import { getRegisteredWebhooks } from '@tribunal/github/webhooks/registered-webhooks';
import { githubContext } from '$lib/server/github-context';
import { getRepositoriesForUser } from '$lib/server/repositories';
import {
  getWebhookEventFilterOptions,
  listWebhookEvents,
  parseWebhookEventFilters,
} from '$lib/server/webhook-events';
import type { PageServerLoad } from './$types';

/**
 * Fetch the GitHub App's currently subscribed webhook events for the
 * optional subscription summary. Best-effort: the App may not be configured
 * in every environment, and this page must render regardless.
 */
async function getSubscribedEventTypesSafely(): Promise<string[]> {
  try {
    const { registered } = await getRegisteredWebhooks(githubContext);
    return registered;
  } catch (error) {
    console.warn('Could not fetch subscribed GitHub App webhook events:', error);
    return [];
  }
}

/**
 * Lists webhook events across every repository the user has added to
 * Tribunal (per `getRepositoriesForUser`), with repository and event
 * filters.
 */
export const load: PageServerLoad = async ({ locals, url }) => {
  const { user } = locals;
  if (!user) redirect(302, '/login');

  const repositoriesResult = await getRepositoriesForUser(user.id);

  if (!repositoriesResult.ok) {
    if (repositoriesResult.error === 'no_github_token') {
      redirect(
        302,
        `/connect/github/account?returnTo=${encodeURIComponent(url.pathname + url.search)}`,
      );
    }

    // GitHub was unreachable. Surface a load error rather than presenting a
    // misleading "no repositories added" empty state.
    return {
      hasRepositories: false,
      repositories: [],
      events: [],
      page: 1,
      perPage: 50,
      totalCount: 0,
      filters: parseWebhookEventFilters(url),
      filterOptions: { eventTypes: [], actions: [] },
      subscribedEventTypes: [],
      loadError: repositoriesResult.message,
    };
  }

  const authorizedRepositories = repositoriesResult.repositories.map((entry) => entry.repository);
  const authorizedRepositoryIds = authorizedRepositories.map((repo) => repo.id);

  const filters = parseWebhookEventFilters(url);
  const subscribedEventTypes = await getSubscribedEventTypesSafely();

  const [eventsResult, filterOptions] = await Promise.all([
    listWebhookEvents(authorizedRepositoryIds, user.id, filters),
    getWebhookEventFilterOptions(authorizedRepositoryIds, undefined, subscribedEventTypes),
  ]);

  return {
    hasRepositories: authorizedRepositories.length > 0,
    repositories: authorizedRepositories
      .map((repo) => ({ id: repo.id, owner: repo.owner, name: repo.name }))
      .sort((a, b) => {
        const left = `${a.owner}/${a.name}`;
        const right = `${b.owner}/${b.name}`;
        if (left === right) return 0;
        return left < right ? -1 : 1;
      }),
    events: eventsResult.events,
    page: eventsResult.page,
    perPage: eventsResult.perPage,
    totalCount: eventsResult.totalCount,
    filters,
    filterOptions,
    subscribedEventTypes,
    loadError: null as string | null,
  };
};
