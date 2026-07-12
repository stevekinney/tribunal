<script lang="ts">
  import { SvelteSet } from 'svelte/reactivity';
  import { Card } from '@lostgradient/cinder/card';
  import { Table } from '@lostgradient/cinder/table';
  import { Button } from '@lostgradient/cinder/button';
  import { Badge } from '@lostgradient/cinder/badge';
  import { Link } from '@lostgradient/cinder/link';
  import { EmptyState } from '@lostgradient/cinder/empty-state';
  import { Alert } from '@lostgradient/cinder/alert';
  import { JsonViewer } from '@lostgradient/cinder/json-viewer';
  import { CodeBlock } from '@lostgradient/cinder/code-block';
  import ChevronRight from 'lucide-svelte/icons/chevron-right';
  import ChevronDown from 'lucide-svelte/icons/chevron-down';
  import Webhook from 'lucide-svelte/icons/webhook';
  import type { WebhookEventRow } from '$lib/server/webhook-events';
  import {
    eventListenerStatusLabel as progressLabel,
    eventListenerStatusVariant as progressVariant,
  } from '$lib/components/event-listener-status';

  let {
    events,
    showRepositoryColumn = true,
    emptyTitle,
    emptyDescription,
  }: {
    events: WebhookEventRow[];
    showRepositoryColumn?: boolean;
    emptyTitle: string;
    emptyDescription: string;
  } = $props();

  const expandedIds = new SvelteSet<number>();

  function toggle(id: number) {
    if (expandedIds.has(id)) {
      expandedIds.delete(id);
    } else {
      expandedIds.add(id);
    }
  }

  /** Compact, non-inferred rendering of the related GitHub object for a row. */
  function relatedObjectLabel(event: WebhookEventRow): string | null {
    const parts: string[] = [];
    if (event.prNumber !== null) parts.push(`PR #${event.prNumber}`);
    if (event.issueNumber !== null) parts.push(`Issue #${event.issueNumber}`);
    if (event.ref) parts.push(event.ref);
    if (event.commitSha) parts.push(event.commitSha.slice(0, 7));
    return parts.length > 0 ? parts.join(' · ') : null;
  }

  function formatReceivedAt(iso: string): string {
    return new Date(iso).toLocaleString();
  }

  const columnCount = $derived(showRepositoryColumn ? 8 : 7);
</script>

{#if events.length === 0}
  <Card padding="none">
    <EmptyState title={emptyTitle} description={emptyDescription}>
      {#snippet icon()}<Webhook size={48} aria-hidden="true" />{/snippet}
    </EmptyState>
  </Card>
{:else}
  <Card padding="none">
    <div class="table-scroll">
      <Table density="comfortable">
        <Table.Header>
          <Table.Row>
            <Table.HeaderCell scope="col">
              <span class="cinder-sr-only">Expand row</span>
            </Table.HeaderCell>
            {#if showRepositoryColumn}
              <Table.HeaderCell scope="col">Repository</Table.HeaderCell>
            {/if}
            <Table.HeaderCell scope="col">Received</Table.HeaderCell>
            <Table.HeaderCell scope="col">Event / action</Table.HeaderCell>
            <Table.HeaderCell scope="col">Related object</Table.HeaderCell>
            <Table.HeaderCell scope="col">Sender</Table.HeaderCell>
            <Table.HeaderCell scope="col">Delivery ID</Table.HeaderCell>
            <Table.HeaderCell scope="col">Listener progress</Table.HeaderCell>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {#each events as event (event.id)}
            {@const expanded = expandedIds.has(event.id)}
            <Table.Row>
              <Table.Cell>
                <Button
                  variant="ghost"
                  size="xs"
                  aria-expanded={expanded}
                  aria-controls={`webhook-event-detail-${event.id}`}
                  onclick={() => toggle(event.id)}
                >
                  {#snippet leadingIcon()}
                    {#if expanded}
                      <ChevronDown size={14} aria-hidden="true" />
                    {:else}
                      <ChevronRight size={14} aria-hidden="true" />
                    {/if}
                  {/snippet}
                  <span class="cinder-sr-only">
                    {expanded ? 'Hide details' : 'Show details'} for delivery {event.deliveryId ??
                      event.id}
                  </span>
                </Button>
              </Table.Cell>
              {#if showRepositoryColumn}
                <Table.Cell as="th">
                  <Link href={`/repositories/${event.repositoryId}/webhooks`}>
                    {event.repositoryOwner}/{event.repositoryName}
                  </Link>
                </Table.Cell>
              {/if}
              <Table.Cell>{formatReceivedAt(event.receivedAt)}</Table.Cell>
              <Table.Cell>
                <Badge size="sm" variant="neutral">{event.eventType}</Badge>
                {#if event.action}
                  <span class="event-action">{event.action}</span>
                {/if}
              </Table.Cell>
              <Table.Cell>{relatedObjectLabel(event) ?? '—'}</Table.Cell>
              <Table.Cell>{event.senderLogin ?? '—'}</Table.Cell>
              <Table.Cell>
                {#if event.deliveryId}
                  <code class="delivery-id">{event.deliveryId}</code>
                {:else}
                  —
                {/if}
              </Table.Cell>
              <Table.Cell>
                <Badge size="sm" variant={progressVariant(event.listenerProgress.status)}>
                  {progressLabel(event.listenerProgress.status)}
                </Badge>
                {#if event.listenerProgress.matchCount > 0}
                  <span class="listener-names">
                    {event.listenerProgress.matchedListenerNames.join(', ')}
                  </span>
                {/if}
              </Table.Cell>
            </Table.Row>
            {#if expanded}
              <Table.Row>
                <Table.Cell colspan={columnCount}>
                  <div id={`webhook-event-detail-${event.id}`} class="detail-panel">
                    <dl class="detail-summary">
                      <div>
                        <dt>Event</dt>
                        <dd>{event.eventType}{event.action ? ` · ${event.action}` : ''}</dd>
                      </div>
                      <div>
                        <dt>Repository</dt>
                        <dd>{event.repositoryOwner}/{event.repositoryName}</dd>
                      </div>
                      <div>
                        <dt>Installation ID</dt>
                        <dd>{event.installationId ?? 'Unknown'}</dd>
                      </div>
                      <div>
                        <dt>Sender</dt>
                        <dd>{event.senderLogin ?? '—'}</dd>
                      </div>
                      <div>
                        <dt>Related object</dt>
                        <dd>{relatedObjectLabel(event) ?? '—'}</dd>
                      </div>
                      <div>
                        <dt>GitHub timestamp</dt>
                        <dd>
                          {event.githubCreatedAt
                            ? formatReceivedAt(event.githubCreatedAt)
                            : 'Unknown'}
                        </dd>
                      </div>
                      <div>
                        <dt>Received</dt>
                        <dd>{formatReceivedAt(event.receivedAt)}</dd>
                      </div>
                      <div>
                        <dt>Delivery ID</dt>
                        <dd>{event.deliveryId ?? 'Unknown'}</dd>
                      </div>
                    </dl>

                    <div class="listener-progress-detail">
                      <h3>Event listener progress</h3>
                      {#if event.listenerProgress.receivedOnly}
                        <p class="listener-progress-empty">
                          No event listeners matched this delivery.
                        </p>
                      {:else}
                        <ul class="listener-match-list">
                          {#each event.listenerProgress.matches as match (match.listenerId)}
                            <li>
                              <div class="listener-match-header">
                                <span class="listener-match-name">{match.listenerName}</span>
                                <Badge size="sm" variant={progressVariant(match.status)}>
                                  {progressLabel(match.status)}
                                </Badge>
                              </div>
                              {#if match.lastError}
                                <Alert variant="danger">{match.lastError}</Alert>
                              {/if}
                              {#if match.runId}
                                <Link href={`/runs/${match.runId}`}>View run</Link>
                              {/if}
                            </li>
                          {/each}
                        </ul>
                      {/if}
                    </div>

                    {#if event.payloadParseError}
                      <Alert variant="warning">
                        This event's stored payload was not valid JSON. Showing the raw text
                        instead.
                      </Alert>
                      <CodeBlock code={event.rawPayload} language="text" copyable />
                    {:else}
                      <JsonViewer value={event.payload} initialDepth={2} />
                    {/if}
                  </div>
                </Table.Cell>
              </Table.Row>
            {/if}
          {/each}
        </Table.Body>
      </Table>
    </div>
  </Card>
{/if}

<style>
  .table-scroll {
    overflow-x: auto;
  }

  .event-action {
    margin-left: var(--space-2);
    color: var(--text-muted);
  }

  .delivery-id {
    font-family: var(--font-mono, monospace);
    font-size: var(--text-sm);
  }

  .listener-names {
    margin-left: var(--space-2);
    color: var(--text-muted);
    font-size: var(--text-sm);
  }

  .listener-progress-detail h3 {
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    margin: 0 0 var(--space-2) 0;
  }

  .listener-progress-empty {
    color: var(--text-muted);
    font-size: var(--text-sm);
    margin: 0;
  }

  .listener-match-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .listener-match-header {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .listener-match-name {
    font-weight: var(--font-medium);
  }

  .detail-panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-3) 0;
  }

  .detail-summary {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(14rem, 100%), 1fr));
    gap: var(--space-3);
    margin: 0;
  }

  .detail-summary dt {
    font-size: var(--text-sm);
    color: var(--text-muted);
  }

  .detail-summary dd {
    margin: 0;
    font-weight: var(--font-medium);
  }
</style>
