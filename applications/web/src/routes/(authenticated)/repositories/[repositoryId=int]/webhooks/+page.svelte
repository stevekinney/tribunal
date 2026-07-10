<script lang="ts">
  import { goto } from '$app/navigation';
  import { page as pageState } from '$app/state';
  import Page from '$lib/components/page.svelte';
  import WebhookEventsTable from '$lib/components/webhook-events-table.svelte';
  import { Card } from '@lostgradient/cinder/card';
  import { Select } from '@lostgradient/cinder/select';
  import { SearchField } from '@lostgradient/cinder/search-field';
  import { FormField } from '@lostgradient/cinder/form-field';
  import { Button } from '@lostgradient/cinder/button';
  import { Pagination } from '@lostgradient/cinder/pagination';

  let { data } = $props();

  /** Navigates to the given page, preserving every other filter in the URL. */
  function goToPage(nextPage: number): void {
    if (nextPage === data.page) return;
    const url = new URL(pageState.url);
    url.searchParams.set('webhook_page', String(nextPage));
    goto(url, { keepFocus: true, noScroll: true });
  }

  const repositoryName = $derived(`${data.repository.owner}/${data.repository.name}`);
  const breadcrumbs = $derived([
    { label: 'Repositories', href: '/repositories' },
    { label: repositoryName, href: `/repositories/${data.repository.id}/pull-requests` },
    { label: 'Webhooks' },
  ]);

  const eventTypeOptions = $derived([
    { value: '', label: 'All event types' },
    ...data.filterOptions.eventTypes.map((eventType) => ({ value: eventType, label: eventType })),
  ]);
  const actionOptions = $derived([
    { value: '', label: 'All actions' },
    ...data.filterOptions.actions.map((action) => ({ value: action, label: action })),
  ]);

  const totalPages = $derived(
    data.totalCount > 0 ? Math.ceil(data.totalCount / data.perPage) : undefined,
  );

  const subtitle = $derived(
    data.totalCount > 0
      ? `${data.totalCount} ${data.totalCount === 1 ? 'event' : 'events'} received for ${repositoryName}`
      : `No webhook events yet for ${repositoryName}`,
  );

  const hasActiveFilters = $derived(
    Boolean(
      data.filters.eventType ||
      data.filters.action ||
      data.filters.deliveryId ||
      data.filters.prNumber ||
      data.filters.issueNumber ||
      data.filters.senderLogin ||
      data.filters.ref,
    ),
  );
</script>

<Page title={`Webhook events · ${repositoryName}`} {subtitle} {breadcrumbs}>
  <Card title="Filters" headingLevel={2}>
    <form method="GET" class="filter-form">
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

  <WebhookEventsTable
    events={data.events}
    showRepositoryColumn={false}
    emptyTitle={hasActiveFilters
      ? 'No webhook events match these filters'
      : 'No webhook events received'}
    emptyDescription={`Webhook deliveries Tribunal receives and verifies for ${repositoryName} will appear here.`}
  />

  {#if totalPages && totalPages > 1}
    <Pagination
      bind:currentPage={() => data.page, (next) => goToPage(next)}
      {totalPages}
      totalCount={data.totalCount}
    />
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
</style>
