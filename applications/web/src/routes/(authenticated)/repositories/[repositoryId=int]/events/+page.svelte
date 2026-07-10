<script lang="ts">
  import Page from '$lib/components/page.svelte';
  import EventListenerForm from './event-listener-form.svelte';
  import { Alert } from '@lostgradient/cinder/alert';
  import { Badge } from '@lostgradient/cinder/badge';
  import { Button } from '@lostgradient/cinder/button';
  import { Card } from '@lostgradient/cinder/card';
  import { ConfirmDialog } from '@lostgradient/cinder/confirm-dialog';
  import { EmptyState } from '@lostgradient/cinder/empty-state';
  import { Table } from '@lostgradient/cinder/table';
  import { Toggle } from '@lostgradient/cinder/toggle';
  import {
    eventListenerStatusLabel,
    eventListenerStatusVariant,
  } from '$lib/components/event-listener-status';
  import Plus from 'lucide-svelte/icons/plus';
  import Trash2 from 'lucide-svelte/icons/trash-2';
  import Zap from 'lucide-svelte/icons/zap';
  import type { ActionData, PageData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();

  const repositoryName = $derived(`${data.repository.owner}/${data.repository.name}`);
  const breadcrumbs = $derived([
    { label: 'Repositories', href: '/repositories' },
    { label: repositoryName, href: `/repositories/${data.repository.id}/pull-requests` },
    { label: 'Events' },
  ]);
  const eventsPath = $derived(`/repositories/${data.repository.id}/events`);

  let deleteTargetId = $state<string | null>(null);

  function formatMatchedAt(value: Date | string | null | undefined): string {
    if (!value) return 'Never';
    return new Date(value).toLocaleString();
  }

  function submitEnabledForm(listenerId: string): void {
    const form = document.getElementById(
      `listener-${listenerId}-enabled-form`,
    ) as HTMLFormElement | null;
    form?.requestSubmit();
  }

  function submitDeleteForm(listenerId: string): void {
    const form = document.getElementById(
      `listener-${listenerId}-delete-form`,
    ) as HTMLFormElement | null;
    form?.requestSubmit();
    deleteTargetId = null;
  }
</script>

<Page title="Events" subtitle={`Event listeners for ${repositoryName}`} {breadcrumbs}>
  {#snippet actions()}
    <Button href={`${eventsPath}?listener=new`} variant="primary" size="sm">
      {#snippet leadingIcon()}<Plus size={14} aria-hidden="true" />{/snippet}
      New listener
    </Button>
  {/snippet}

  {#if form?.error && !data.editing}
    <Alert variant="danger">{form.error}</Alert>
  {/if}

  {#if data.editing}
    {#key data.editing}
      <EventListenerForm
        mode={data.editing === 'new' ? 'new' : 'edit'}
        listener={data.editingListener}
        listenerFilters={data.editingListenerFilters}
        agents={data.agents}
        eventTypeOptions={data.eventTypeOptions}
        actionsByEventType={data.actionsByEventType}
        {form}
        cancelHref={eventsPath}
      />
    {/key}
  {/if}

  {#if data.listeners.length === 0}
    <Card padding="none">
      <EmptyState
        title="No event listeners"
        description="Event listeners run an agent whenever a matching GitHub webhook delivery arrives for this repository."
      >
        {#snippet icon()}<Zap size={48} aria-hidden="true" />{/snippet}
        {#snippet action()}
          <Button href={`${eventsPath}?listener=new`} variant="primary" size="sm">
            {#snippet leadingIcon()}<Plus size={14} aria-hidden="true" />{/snippet}
            New listener
          </Button>
        {/snippet}
      </EmptyState>
    </Card>
  {:else}
    <Card padding="none">
      <div class="table-scroll">
        <Table density="comfortable">
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell scope="col">Name</Table.HeaderCell>
              <Table.HeaderCell scope="col">Event / action</Table.HeaderCell>
              <Table.HeaderCell scope="col">Agent</Table.HeaderCell>
              <Table.HeaderCell scope="col">Enabled</Table.HeaderCell>
              <Table.HeaderCell scope="col">Last matched</Table.HeaderCell>
              <Table.HeaderCell scope="col">Last run status</Table.HeaderCell>
              <Table.HeaderCell scope="col">
                <span class="cinder-sr-only">Manage</span>
              </Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {#each data.listeners as row (row.listener.id)}
              <Table.Row>
                <Table.Cell as="th">{row.listener.name}</Table.Cell>
                <Table.Cell>
                  <Badge size="sm" variant="neutral">{row.listener.eventType}</Badge>
                  {#if row.listener.action}
                    <span class="listener-action">{row.listener.action}</span>
                  {/if}
                </Table.Cell>
                <Table.Cell>{row.agentSlug}{row.agentEnabled ? '' : ' (disabled)'}</Table.Cell>
                <Table.Cell>
                  <form
                    id={`listener-${row.listener.id}-enabled-form`}
                    method="POST"
                    action="?/setEnabled"
                  >
                    <input type="hidden" name="listenerId" value={row.listener.id} />
                    <input
                      type="hidden"
                      name="enabled"
                      value={row.listener.enabled ? 'false' : 'true'}
                    />
                    <Toggle
                      id={`listener-${row.listener.id}-enabled`}
                      label={`${row.listener.enabled ? 'Disable' : 'Enable'} ${row.listener.name}`}
                      hideLabel
                      checked={row.listener.enabled}
                      onValueChange={(next) => {
                        if (next === row.listener.enabled) return;
                        submitEnabledForm(row.listener.id);
                      }}
                    />
                  </form>
                </Table.Cell>
                <Table.Cell>{formatMatchedAt(row.lastDelivery?.matchedAt)}</Table.Cell>
                <Table.Cell>
                  {#if row.lastDelivery}
                    <Badge
                      size="sm"
                      variant={eventListenerStatusVariant(row.lastDelivery.displayStatus)}
                    >
                      {eventListenerStatusLabel(row.lastDelivery.displayStatus)}
                    </Badge>
                  {:else}
                    <span class="no-runs">No runs yet</span>
                  {/if}
                </Table.Cell>
                <Table.Cell>
                  <div class="row-actions">
                    <Button
                      href={`${eventsPath}?listener=${row.listener.id}`}
                      variant="secondary"
                      size="sm"
                    >
                      Manage
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      onclick={() => (deleteTargetId = row.listener.id)}
                    >
                      {#snippet leadingIcon()}<Trash2 size={14} aria-hidden="true" />{/snippet}
                      <span class="cinder-sr-only">Delete {row.listener.name}</span>
                    </Button>
                    <form
                      id={`listener-${row.listener.id}-delete-form`}
                      method="POST"
                      action="?/delete"
                    >
                      <input type="hidden" name="listenerId" value={row.listener.id} />
                    </form>
                  </div>
                </Table.Cell>
              </Table.Row>
            {/each}
          </Table.Body>
        </Table>
      </div>
    </Card>
  {/if}

  <ConfirmDialog
    open={deleteTargetId !== null}
    title="Delete event listener"
    description="Deleting this listener does not affect runs it has already spawned."
    confirmLabel="Delete"
    destructive
    onconfirm={() => {
      if (deleteTargetId) submitDeleteForm(deleteTargetId);
    }}
    oncancel={() => (deleteTargetId = null)}
  />
</Page>

<style>
  .table-scroll {
    overflow-x: auto;
  }

  .listener-action {
    margin-left: var(--space-2);
    color: var(--text-muted);
  }

  .no-runs {
    color: var(--text-muted);
    font-size: var(--text-sm);
  }

  .row-actions {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
</style>
