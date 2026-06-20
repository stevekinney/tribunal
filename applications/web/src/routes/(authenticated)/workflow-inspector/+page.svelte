<script lang="ts">
  import Page from '$lib/components/page.svelte';
  import { Alert } from '@lostgradient/cinder/alert';
  import { Badge } from '@lostgradient/cinder/badge';
  import { Card } from '@lostgradient/cinder/card';
  import { Feed } from '@lostgradient/cinder/feed';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  const activeRuns = $derived(
    data.runs.filter((run) => run.status === 'running' || run.status === 'queued'),
  );
  const failedRuns = $derived(data.runs.filter((run) => isStoppedRun(run.status)));
  const latestRun = $derived(data.runs[0] ?? null);
  const recentWorkflowRuns = $derived(data.runs.slice(0, 10));

  function toDate(value: Date | string): Date {
    return value instanceof Date ? value : new Date(value);
  }

  function toDateTime(value: Date | string): string {
    const date = toDate(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
  }

  function toTimestamp(value: Date | string | null): string {
    if (value === null) return 'not started';
    const date = toDate(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
  }

  function isStoppedRun(status: string): boolean {
    return status === 'failed' || status === 'cancelled' || status === 'quota_blocked';
  }
</script>

<Page title="Workflow Inspector" subtitle="Durable Weft workflow state">
  {#if !data.enabled}
    <Alert variant="warning">Workflow inspector is hidden.</Alert>
  {:else}
    <div class="surface-states" aria-label="Surface states">
      {#each data.surfaceStates as state (state)}
        <Badge size="sm">{state}</Badge>
      {/each}
    </div>
    <div class="inspector-grid">
      <Card>
        <h2>Recent runs</h2>
        {#if data.runs.length === 0}
          <p class="muted">No review workflows recorded.</p>
        {:else}
          <Feed aria-label="Recent review runs">
            {#each recentWorkflowRuns as run (run.id)}
              {#if run.startedAt}
                <Feed.Event
                  variant="minimal"
                  datetime={toDateTime(run.startedAt)}
                  timestamp={toTimestamp(run.startedAt)}
                >
                  <div class="workflow-run-entry">
                    <div class="workflow-run-entry__header">
                      <Badge size="sm">{run.status}</Badge>
                      <strong>review-pr:{run.repositoryId}:{run.prNumber}</strong>
                    </div>
                    <span>{run.repositoryOwner}/{run.repositoryName} #{run.prNumber}</span>
                    <small>review-run:{run.id}</small>
                  </div>
                </Feed.Event>
              {:else}
                <li class="workflow-run-entry workflow-run-entry--pending">
                  <div class="workflow-run-entry__header">
                    <Badge size="sm">{run.status}</Badge>
                    <strong>review-pr:{run.repositoryId}:{run.prNumber}</strong>
                  </div>
                  <span>{run.repositoryOwner}/{run.repositoryName} #{run.prNumber}</span>
                  <small>review-run:{run.id}</small>
                  <small>not started</small>
                </li>
              {/if}
            {/each}
          </Feed>
        {/if}
      </Card>
      <Card>
        <h2>Signals and timers</h2>
        <dl>
          <div>
            <dt>Active signals</dt>
            <dd>{activeRuns.length}</dd>
          </div>
          <div>
            <dt>Failed or stopped</dt>
            <dd aria-label="Failed or stopped count">{failedRuns.length}</dd>
          </div>
          <div>
            <dt>Latest timer</dt>
            <dd>{latestRun?.startedAt ? toTimestamp(latestRun.startedAt) : 'none'}</dd>
          </div>
        </dl>
      </Card>
      <Card>
        <h2>Child tree</h2>
        {#if data.runs.length === 0}
          <p class="muted">No child workflow records loaded.</p>
        {:else}
          <ul>
            {#each data.runs.slice(0, 10) as run (run.id)}
              <li>
                <strong>review-pr</strong>
                <span>review-run:{run.id}</span>
                <small>agent-review children visible from the run detail timeline.</small>
              </li>
            {/each}
          </ul>
        {/if}
      </Card>
    </div>
  {/if}
</Page>

<style>
  .inspector-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
    gap: var(--space-4);
  }

  h2 {
    font-size: var(--text-base);
    font-weight: var(--font-semibold);
    color: var(--text);
  }

  .surface-states {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin-bottom: var(--space-4);
  }

  ul {
    display: grid;
    gap: var(--space-2);
    padding-left: var(--space-5);
  }

  li {
    display: grid;
    gap: var(--space-1);
  }

  .workflow-run-entry {
    display: grid;
    gap: var(--space-1);
  }

  .workflow-run-entry--pending {
    list-style: none;
    padding-left: var(--space-9);
  }

  .workflow-run-entry__header {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  dl {
    display: grid;
    gap: var(--space-3);
  }

  dl div {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
  }

  dt,
  .muted {
    color: var(--text-muted);
  }

  dd {
    margin: 0;
    font-weight: var(--font-semibold);
    color: var(--text);
  }

  small {
    color: var(--text-muted);
  }
</style>
