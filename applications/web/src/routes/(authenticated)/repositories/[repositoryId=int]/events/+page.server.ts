import { error, fail, redirect } from '@sveltejs/kit';
import { getRepositoryById } from '@tribunal/github/repositories/service';
import { getRegisteredWebhooks } from '@tribunal/github/webhooks/registered-webhooks';
import {
  createEventListener,
  deleteEventListener,
  EventListenerAgentOwnershipError,
  InvalidEventListenerFiltersError,
  listEventListenersWithProgressForRepository,
  parseEventListenerFilters,
  setEventListenerEnabled,
  updateEventListener,
  type EventListenerFilters,
} from '@tribunal/database/queries';
import { db } from '$lib/server/database';
import { githubContext } from '$lib/server/github-context';
import { userCanAccessRepository } from '$lib/server/repositories';
import { listAgents } from '$lib/server/review/operator';
import {
  getObservedEventTypeActionMap,
  getWebhookEventFilterOptions,
} from '$lib/server/webhook-events';
import type { Actions, PageServerLoad } from './$types';

/**
 * Fetch the GitHub App's currently subscribed webhook events, best-effort.
 * The App may not be configured in every environment, and this page must
 * render regardless -- see the identical pattern on the webhooks pages.
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

/** Resolves the requesting user and confirms repository access for a form action. */
async function requireRepositoryAccess(
  locals: App.Locals,
  params: { repositoryId: string },
): Promise<{ userId: number; repositoryId: number }> {
  const { user } = locals;
  if (!user) redirect(302, '/login');

  const repositoryId = Number(params.repositoryId);
  const canAccess = await userCanAccessRepository(user.id, repositoryId);
  if (!canAccess) error(404, 'Repository not found');

  return { userId: user.id, repositoryId };
}

/**
 * Parses the supported named filter fields from a listener form submission.
 * Numeric fields are validated as integers before being handed to
 * `serializeEventListenerFilters` (via `createEventListener`/
 * `updateEventListener`), which independently validates and serializes them.
 */
function parseFiltersFromFormData(formData: FormData): EventListenerFilters {
  const filters: EventListenerFilters = {};

  const ref = String(formData.get('filterRef') ?? '').trim();
  if (ref) filters.ref = ref;

  const senderLogin = String(formData.get('filterSenderLogin') ?? '').trim();
  if (senderLogin) filters.senderLogin = senderLogin;

  const prNumberRaw = String(formData.get('filterPrNumber') ?? '').trim();
  if (prNumberRaw) {
    const value = Number(prNumberRaw);
    if (!Number.isInteger(value)) {
      throw new InvalidEventListenerFiltersError('Filter "prNumber" must be an integer');
    }
    filters.prNumber = value;
  }

  const issueNumberRaw = String(formData.get('filterIssueNumber') ?? '').trim();
  if (issueNumberRaw) {
    const value = Number(issueNumberRaw);
    if (!Number.isInteger(value)) {
      throw new InvalidEventListenerFiltersError('Filter "issueNumber" must be an integer');
    }
    filters.issueNumber = value;
  }

  return filters;
}

/**
 * Lists event listeners configured for a repository the user can access, and
 * loads the create/edit form context: agents to choose from, event type
 * choices (subscribed App events plus received event types), and observed
 * actions per event type.
 */
export const load: PageServerLoad = async ({ locals, params, url }) => {
  const { user } = locals;
  if (!user) redirect(302, '/login');

  const repositoryId = Number(params.repositoryId);

  const repositoryRow = await getRepositoryById(githubContext, repositoryId);
  if (!repositoryRow) error(404, 'Repository not found');

  const canAccess = await userCanAccessRepository(user.id, repositoryId);
  if (!canAccess) error(404, 'Repository not found');

  const [listeners, agents, subscribedEventTypes, actionsByEventType] = await Promise.all([
    listEventListenersWithProgressForRepository(db, user.id, repositoryId),
    listAgents(user.id),
    getSubscribedEventTypesSafely(),
    getObservedEventTypeActionMap(repositoryId),
  ]);

  const filterOptions = await getWebhookEventFilterOptions(
    [repositoryId],
    repositoryId,
    subscribedEventTypes,
  );

  const editingParam = url.searchParams.get('listener');
  const editingListener =
    editingParam && editingParam !== 'new'
      ? (listeners.find((row) => row.listener.id === editingParam)?.listener ?? null)
      : null;
  const editingListenerFilters = editingListener
    ? (parseEventListenerFilters(editingListener.filtersJson) ?? {})
    : {};

  // Include the listener's own stored event type even if it has since
  // dropped out of the subscribed/received set (App subscription removed,
  // App lookup failed, or no matching event received yet). Otherwise an
  // ordinary edit can no longer submit the listener's current event type.
  const eventTypeOptions =
    editingListener && !filterOptions.eventTypes.includes(editingListener.eventType)
      ? [...filterOptions.eventTypes, editingListener.eventType].sort()
      : filterOptions.eventTypes;

  return {
    repository: {
      id: repositoryRow.id,
      owner: repositoryRow.owner,
      name: repositoryRow.name,
    },
    listeners,
    agents: agents.map((agentRow) => ({
      id: agentRow.id,
      slug: agentRow.slug,
      enabled: agentRow.enabled,
    })),
    eventTypeOptions,
    actionsByEventType,
    editing: editingParam === 'new' ? ('new' as const) : (editingListener?.id ?? null),
    editingListener,
    editingListenerFilters,
  };
};

export const actions: Actions = {
  create: async ({ locals, params, request }) => {
    const { userId, repositoryId } = await requireRepositoryAccess(locals, params);
    const formData = await request.formData();

    const name = String(formData.get('name') ?? '').trim();
    const eventType = String(formData.get('eventType') ?? '').trim();
    const actionValue = String(formData.get('action') ?? '').trim();
    const agentId = String(formData.get('agentId') ?? '').trim();
    const instructionsMarkdown = String(formData.get('instructionsMarkdown') ?? '');
    // Toggle's native checkbox submission (used by the create/edit form)
    // mirrors HTML checkbox semantics: present with value "on" only while
    // checked. The list view's instant enable/disable toggle uses an
    // explicit "true"/"false" hidden input instead -- see `setEnabled` below.
    const enabled = formData.get('enabled') === 'on';

    if (!name) return fail(400, { error: 'Name is required.' });
    if (!eventType) return fail(400, { error: 'Event type is required.' });
    if (!agentId) return fail(400, { error: 'Select an agent.' });

    let filters: EventListenerFilters;
    try {
      filters = parseFiltersFromFormData(formData);
    } catch (thrown) {
      const message =
        thrown instanceof InvalidEventListenerFiltersError ? thrown.message : 'Invalid filters.';
      return fail(400, { error: message });
    }

    try {
      await createEventListener(db, {
        userId,
        repositoryId,
        name,
        eventType,
        action: actionValue || null,
        filters,
        agentId,
        instructionsMarkdown,
        enabled,
      });
    } catch (thrown) {
      if (thrown instanceof EventListenerAgentOwnershipError) {
        return fail(400, { error: 'Select an agent you own.' });
      }
      throw thrown;
    }

    redirect(303, `/repositories/${repositoryId}/events`);
  },

  update: async ({ locals, params, request }) => {
    const { userId, repositoryId } = await requireRepositoryAccess(locals, params);
    const formData = await request.formData();

    const listenerId = String(formData.get('listenerId') ?? '').trim();
    if (!listenerId) return fail(400, { error: 'Missing listener id.' });

    const name = String(formData.get('name') ?? '').trim();
    const eventType = String(formData.get('eventType') ?? '').trim();
    const actionValue = String(formData.get('action') ?? '').trim();
    const agentId = String(formData.get('agentId') ?? '').trim();
    const instructionsMarkdown = String(formData.get('instructionsMarkdown') ?? '');
    // Toggle's native checkbox submission (used by the create/edit form)
    // mirrors HTML checkbox semantics: present with value "on" only while
    // checked. The list view's instant enable/disable toggle uses an
    // explicit "true"/"false" hidden input instead -- see `setEnabled` below.
    const enabled = formData.get('enabled') === 'on';

    if (!name) return fail(400, { error: 'Name is required.' });
    if (!eventType) return fail(400, { error: 'Event type is required.' });
    if (!agentId) return fail(400, { error: 'Select an agent.' });

    let filters: EventListenerFilters;
    try {
      filters = parseFiltersFromFormData(formData);
    } catch (thrown) {
      const message =
        thrown instanceof InvalidEventListenerFiltersError ? thrown.message : 'Invalid filters.';
      return fail(400, { error: message });
    }

    try {
      const updated = await updateEventListener(db, userId, repositoryId, listenerId, {
        name,
        eventType,
        action: actionValue || null,
        filters,
        agentId,
        instructionsMarkdown,
        enabled,
      });
      if (!updated) return fail(404, { error: 'Listener not found.' });
    } catch (thrown) {
      if (thrown instanceof EventListenerAgentOwnershipError) {
        return fail(400, { error: 'Select an agent you own.' });
      }
      throw thrown;
    }

    redirect(303, `/repositories/${repositoryId}/events`);
  },

  setEnabled: async ({ locals, params, request }) => {
    const { userId, repositoryId } = await requireRepositoryAccess(locals, params);
    const formData = await request.formData();

    const listenerId = String(formData.get('listenerId') ?? '').trim();
    const enabled = formData.get('enabled') === 'true';
    if (!listenerId) return fail(400, { error: 'Missing listener id.' });

    const updated = await setEventListenerEnabled(db, userId, repositoryId, listenerId, enabled);
    if (!updated) return fail(404, { error: 'Listener not found.' });

    return { success: true };
  },

  delete: async ({ locals, params, request }) => {
    const { userId, repositoryId } = await requireRepositoryAccess(locals, params);
    const formData = await request.formData();

    const listenerId = String(formData.get('listenerId') ?? '').trim();
    if (!listenerId) return fail(400, { error: 'Missing listener id.' });

    const deleted = await deleteEventListener(db, userId, repositoryId, listenerId);
    if (!deleted) return fail(404, { error: 'Listener not found.' });

    return { success: true };
  },
};
