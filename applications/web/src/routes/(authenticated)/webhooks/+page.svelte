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

  let { data } = $props();

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
</script>

<Page title="Webhook events" {subtitle}>
  {#if data.loadError}
    <Alert variant="danger">{data.loadError}</Alert>
  {/if}

  {#if !data.loadError && !data.hasRepositories}
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
      <Card title="Subscribed events" description="Events GitHub currently sends to this App.">
        <div class="subscribed-events">
          {#each data.subscribedEventTypes as eventType (eventType)}
            <Badge size="sm" variant="neutral">{eventType}</Badge>
          {/each}
        </div>
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
</style>
