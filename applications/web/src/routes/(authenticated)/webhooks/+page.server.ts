import { redirect } from '@sveltejs/kit';
import { getRegisteredWebhooks } from '@tribunal/github/webhooks/registered-webhooks';
import { githubContext } from '$lib/server/github-context';
import { getRepositoriesForUser } from '$lib/server/repositories';
import { computeHandledWebhookEventDrift } from '$lib/server/github/webhooks/subscription-drift';
import {
  getWebhookEventFilterOptions,
  listWebhookEvents,
  parseWebhookEventFilters,
} from '$lib/server/webhook-events';
import type { PageServerLoad } from './$types';

/** Result of {@link getSubscribedEventTypesSafely} — see its doc comment. */
type SubscribedEventTypesFetch = { ok: true; registered: string[] } | { ok: false };

/**
 * Fetch the GitHub App's currently subscribed webhook events for the
 * subscription summary and drift banner. Best-effort: the App may not be
 * configured in every environment, and this page must render regardless.
 *
 * Returns a discriminated result rather than swallowing failures into an
 * empty array, so callers can tell "the App is subscribed to nothing" apart
 * from "we could not determine the App's subscription" — conflating the two
 * would let a transient GitHub outage render a false "everything is
 * unsubscribed" drift warning.
 */
async function getSubscribedEventTypesSafely(): Promise<SubscribedEventTypesFetch> {
  try {
    const { registered } = await getRegisteredWebhooks(githubContext);
    return { ok: true, registered };
  } catch (error) {
    console.warn('Could not fetch subscribed GitHub App webhook events:', error);
    return { ok: false };
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
      filterOptions: { eventTypes: [], actions: [], receivedEventTypes: [] },
      subscribedEventTypes: [],
      driftedEventTypes: [],
      subscriptionStatusKnown: false,
      loadError: repositoriesResult.message,
    };
  }

  const authorizedRepositories = repositoriesResult.repositories.map((entry) => entry.repository);
  const authorizedRepositoryIds = authorizedRepositories.map((repo) => repo.id);

  const filters = parseWebhookEventFilters(url);
  const subscriptionFetch = await getSubscribedEventTypesSafely();
  const subscribedEventTypes = subscriptionFetch.ok ? subscriptionFetch.registered : [];
  // Only ever computed from a successful fetch — see `getSubscribedEventTypesSafely`'s
  // doc comment for why an unknown subscription must never be presented as drift.
  const driftedEventTypes = subscriptionFetch.ok
    ? computeHandledWebhookEventDrift(subscriptionFetch.registered)
    : [];

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
    driftedEventTypes,
    subscriptionStatusKnown: subscriptionFetch.ok,
    loadError: null as string | null,
  };
};
