<script lang="ts">
  import type { PageProps } from './$types';
  import type { StatusDotStatus } from '@lostgradient/cinder/status-dot';
  import type { BadgeVariant } from '@lostgradient/cinder/badge';
  import Page from '$lib/components/page.svelte';
  import { Badge } from '@lostgradient/cinder/badge';
  import { Card } from '@lostgradient/cinder/card';
  import { StatusDot } from '@lostgradient/cinder/status-dot';
  import { Table } from '@lostgradient/cinder/table';
  import { formatDuration } from '$lib/utilities/format-duration';

  let { data }: PageProps = $props();

  type StatusConfig = { dot: StatusDotStatus; badge: BadgeVariant; label: string };

  const STATUS_CONFIG: Record<string, StatusConfig> = {
    queued: { dot: 'pending', badge: 'neutral', label: 'Queued' },
    running: { dot: 'accent', badge: 'accent', label: 'Running' },
    posted: { dot: 'success', badge: 'success', label: 'Posted' },
    superseded: { dot: 'neutral', badge: 'neutral', label: 'Superseded' },
    failed: { dot: 'danger', badge: 'danger', label: 'Failed' },
    cancelled: { dot: 'neutral', badge: 'neutral', label: 'Cancelled' },
    quota_blocked: { dot: 'warning', badge: 'warning', label: 'Quota blocked' },
  };

  const DEFAULT_STATUS: StatusConfig = { dot: 'neutral', badge: 'neutral', label: 'Unknown' };

  function getStatusConfig(status: string): StatusConfig {
    return STATUS_CONFIG[status] ?? DEFAULT_STATUS;
  }

  const SOURCE_LABELS: Record<string, string> = {
    pull_request_review: 'Pull request review',
    webhook_event_handler: 'Webhook event',
  };

  function getSourceLabel(runKind: string): string {
    return SOURCE_LABELS[runKind] ?? runKind;
  }
</script>

<Page title="Runs" subtitle="Recent runs">
  {#if data.runs.length === 0}
    <Card>
      <p class="muted">No runs have started yet.</p>
    </Card>
  {:else}
    <Card padding="none">
      <Table
        aria-label="Recent runs"
        scrollable
        scrollContainerProps={{ 'aria-label': 'Recent runs' }}
        density="comfortable"
      >
        <Table.Header>
          <Table.Row>
            <Table.HeaderCell>Pull request</Table.HeaderCell>
            <Table.HeaderCell>Source</Table.HeaderCell>
            <Table.HeaderCell>Status</Table.HeaderCell>
            <Table.HeaderCell align="right">Findings</Table.HeaderCell>
            <Table.HeaderCell align="right">Cost</Table.HeaderCell>
            <Table.HeaderCell align="right">Duration</Table.HeaderCell>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {#each data.runs as run (run.id)}
            {@const statusConfig = getStatusConfig(run.status)}
            <Table.Row>
              <Table.Cell as="th">
                <a href={`/runs/${run.id}`} class="pr-link">
                  <div class="pr-cell">
                    <span class="pr-title">{run.repositoryOwner}/{run.repositoryName}</span>
                    <span class="pr-ref">#{run.prNumber}</span>
                  </div>
                </a>
              </Table.Cell>
              <Table.Cell>
                <span class="source-cell">
                  <span>{getSourceLabel(run.runKind)}</span>
                  <span class="pr-ref">{run.trigger}</span>
                </span>
              </Table.Cell>
              <Table.Cell>
                <Badge variant={statusConfig.badge} size="sm">
                  <StatusDot
                    status={statusConfig.dot}
                    size="sm"
                    showLabel={false}
                    aria-hidden="true"
                  />
                  {statusConfig.label}
                </Badge>
              </Table.Cell>
              <Table.Cell align="right">
                <span class="mono">{run.commentsPosted}</span>
              </Table.Cell>
              <Table.Cell align="right">
                <span class="mono">${Number(run.costEstimateUsd).toFixed(2)}</span>
              </Table.Cell>
              <Table.Cell align="right">
                <span class="duration">{formatDuration(run.startedAt, run.finishedAt)}</span>
              </Table.Cell>
            </Table.Row>
          {/each}
        </Table.Body>
      </Table>
    </Card>
  {/if}
</Page>

<style>
  .muted {
    color: var(--text-muted);
  }

  .pr-link {
    display: block;
    color: inherit;
    text-decoration: none;
  }

  .pr-cell {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .pr-title {
    font-weight: var(--font-medium);
    color: var(--text);
  }

  .source-cell {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .pr-ref {
    font-size: var(--text-xs);
    color: var(--text-subtle);
    font-family: var(--font-mono);
  }

  .mono {
    font-family: var(--font-mono);
    color: var(--text);
    font-size: var(--text-sm);
  }

  .duration {
    color: var(--text-subtle);
    white-space: nowrap;
    font-size: var(--text-sm);
  }
</style>
