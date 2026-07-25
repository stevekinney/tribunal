<script lang="ts">
  import { goto } from '$app/navigation';
  import { page as pageState } from '$app/state';
  import Page from '$lib/components/page.svelte';
  import WebhookEventsTable from '$lib/components/webhook-events-table.svelte';
  import { Alert } from '@lostgradient/cinder/alert';
  import { Card } from '@lostgradient/cinder/card';
  import { Select } from '@lostgradient/cinder/select';
  import { SearchField } from '@lostgradient/cinder/search-field';
  import { FormField } from '@lostgradient/cinder/form-field';
  import { Button } from '@lostgradient/cinder/button';
  import { Badge } from '@lostgradient/cinder/badge';
  import { Pagination } from '@lostgradient/cinder/pagination';
  import { EmptyState } from '@lostgradient/cinder/empty-state';
  import FolderGit2 from 'lucide-svelte/icons/folder-git-2';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  /** Navigates to the given page, preserving every other filter in the URL. */
  function goToPage(nextPage: number): void {
    if (nextPage === data.page) return;
    const url = new URL(pageState.url);
    url.searchParams.set('webhook_page', String(nextPage));
    goto(url, { keepFocus: true, noScroll: true });
  }

  const eventTypeOptions = $derived([
    { value: '', label: 'All event types' },
    ...data.filterOptions.eventTypes.map((eventType) => ({ value: eventType, label: eventType })),
  ]);
  const actionOptions = $derived([
    { value: '', label: 'All actions' },
    ...data.filterOptions.actions.map((action) => ({ value: action, label: action })),
  ]);
  const repositoryOptions = $derived([
    { value: '', label: 'All repositories' },
    ...data.repositories.map((repo) => ({
      value: String(repo.id),
      label: `${repo.owner}/${repo.name}`,
    })),
  ]);

  const totalPages = $derived(
    data.totalCount > 0 ? Math.ceil(data.totalCount / data.perPage) : undefined,
  );

  const subtitle = $derived(
    data.totalCount > 0
      ? `${data.totalCount} ${data.totalCount === 1 ? 'event' : 'events'} received`
      : 'No webhook events yet',
  );

  const hasActiveFilters = $derived(
    Boolean(
      data.filters.eventType ||
      data.filters.action ||
      data.filters.repositoryId ||
      data.filters.deliveryId ||
      data.filters.prNumber ||
      data.filters.issueNumber ||
      data.filters.senderLogin ||
      data.filters.ref,
    ),
  );

  const receivedEventTypeSet = $derived(new Set(data.filterOptions.receivedEventTypes ?? []));
  // Partition (not duplicate) subscribed events by whether Tribunal has
  // actually received one yet -- "subscribed but zero received" and
  // "receiving events normally" are different operational situations that
  // otherwise render identically.
  const activeSubscribedEventTypes = $derived(
    data.subscribedEventTypes.filter((eventType) => receivedEventTypeSet.has(eventType)),
  );
  const quietSubscribedEventTypes = $derived(
    data.subscribedEventTypes.filter((eventType) => !receivedEventTypeSet.has(eventType)),
  );

  const driftIsSingular = $derived(data.driftedEventTypes.length === 1);
</script>

<Page title="Webhook events" {subtitle}>
  {#if data.loadError}
    <Alert variant="danger">{data.loadError}</Alert>
  {:else if !data.hasRepositories}
    <Card padding="none">
      <EmptyState
        title="No repositories added"
        description="Add a repository to Tribunal before webhook events can be received."
      >
        {#snippet icon()}<FolderGit2 size={48} aria-hidden="true" />{/snippet}
        {#snippet action()}
          <Button href="/repositories" variant="primary" size="sm">Go to repositories</Button>
        {/snippet}
      </EmptyState>
    </Card>
  {:else}
    {#if data.driftedEventTypes.length > 0}
      <Alert variant="warning">
        Tribunal can act on <strong>{data.driftedEventTypes.join(', ')}</strong>, but the GitHub App
        is not currently subscribed to {driftIsSingular ? 'it' : 'them'}. Webhook deliveries for {driftIsSingular
          ? 'this event type'
          : 'these event types'} will never arrive until the App's webhook event subscription is updated.
        See "Subscribed events" in
        <code>documentation/INTEGRATIONS.md</code> for the expected subscription list, update it in
        the GitHub App settings, then confirm with <code>GET /api/webhooks/github</code>.
      </Alert>
    {/if}

    {#if !data.subscriptionStatusKnown}
      <Alert variant="warning">
        Could not determine the GitHub App's webhook subscription, so subscription drift cannot be
        checked right now. This does not necessarily mean any events are missing.
      </Alert>
    {/if}

    <Card title="Filters" headingLevel={2}>
      <form method="GET" class="filter-form">
        <Select
          id="webhook-repository-filter"
          name="webhook_repository_id"
          label="Repository"
          value={data.filters.repositoryId ? String(data.filters.repositoryId) : ''}
          options={repositoryOptions}
        />
        <Select
          id="webhook-event-type-filter"
          name="webhook_event_type"
          label="Event type"
          value={data.filters.eventType ?? ''}
          options={eventTypeOptions}
        />
        <Select
          id="webhook-action-filter"
          name="webhook_action"
          label="Action"
          value={data.filters.action ?? ''}
          options={actionOptions}
        />
        <FormField id="webhook-delivery-id-filter" label="Delivery ID">
          <SearchField
            id="webhook-delivery-id-filter"
            name="webhook_delivery_id"
            value={data.filters.deliveryId ?? ''}
            placeholder="Exact delivery ID"
          />
        </FormField>
        <div class="filter-actions">
          <Button type="submit" variant="primary" size="sm">Apply filters</Button>
        </div>
      </form>
    </Card>

    {#if data.subscribedEventTypes.length > 0}
      <Card
        title="Subscribed events"
        description="Events GitHub currently sends to this App."
        headingLevel={2}
      >
        {#if activeSubscribedEventTypes.length > 0}
          <p class="subscribed-events-heading">Receiving events:</p>
          <div class="subscribed-events">
            {#each activeSubscribedEventTypes as eventType (eventType)}
              <Badge size="sm" variant="success">{eventType}</Badge>
            {/each}
          </div>
        {/if}
        {#if quietSubscribedEventTypes.length > 0}
          <p class="subscribed-events-heading">Subscribed, but no events received yet:</p>
          <div class="subscribed-events">
            {#each quietSubscribedEventTypes as eventType (eventType)}
              <Badge size="sm" variant="neutral">{eventType}</Badge>
            {/each}
          </div>
        {/if}
      </Card>
    {/if}

    <WebhookEventsTable
      events={data.events}
      showRepositoryColumn
      emptyTitle={hasActiveFilters
        ? 'No webhook events match these filters'
        : 'No webhook events received'}
      emptyDescription="Webhook deliveries Tribunal receives and verifies for your repositories will appear here."
    />

    {#if totalPages && totalPages > 1}
      <Pagination
        bind:currentPage={() => data.page, (next) => goToPage(next)}
        {totalPages}
        totalCount={data.totalCount}
      />
    {/if}
  {/if}
</Page>

<style>
  .filter-form {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(14rem, 100%), 1fr));
    gap: var(--space-3);
    align-items: end;
  }

  .filter-actions {
    display: flex;
    align-items: end;
  }

  .subscribed-events {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .subscribed-events-heading {
    margin-top: var(--space-3);
    margin-bottom: var(--space-2);
    color: var(--cinder-text-muted);
    font-size: var(--cinder-text-sm);
  }

  .subscribed-events-heading:first-child {
    margin-top: 0;
  }
</style>
