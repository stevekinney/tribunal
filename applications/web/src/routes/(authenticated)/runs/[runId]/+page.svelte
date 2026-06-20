<script lang="ts">
  import Page from '$lib/components/page.svelte';
  import { Alert } from '@lostgradient/cinder/alert';
  import { Badge } from '@lostgradient/cinder/badge';
  import { Button } from '@lostgradient/cinder/button';
  import { Card } from '@lostgradient/cinder/card';
  import { EventStreamViewer } from '@lostgradient/cinder/event-stream-viewer';
  import type { EventStreamState, StreamEvent } from '@lostgradient/cinder/event-stream-viewer';
  import { Link } from '@lostgradient/cinder/link';
  import { invalidateAll } from '$app/navigation';
  import { Square } from 'lucide-svelte';
  import { untrack } from 'svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  type AgentRun = PageData['run']['agentRuns'][number];
  type AgentEvent = AgentRun['events'][number];

  const run = $derived(data.run);
  let connectionState = $state<'connecting' | 'streaming' | 'disconnected'>('disconnected');
  const canStopRun = $derived(run.status === 'running' || run.status === 'queued');
  const connected = $derived(canStopRun && connectionState === 'streaming');
  const connectionLabel = $derived(canStopRun ? connectionState : 'disconnected');
  const eventStreamConnectionState = $derived<EventStreamState>(
    canStopRun && connectionState === 'streaming'
      ? 'connected'
      : connectionState === 'connecting'
        ? 'connecting'
        : 'disconnected',
  );
  const latestAgentEventId = $derived.by(() => {
    let latestId = 0;
    for (const agentRun of run.agentRuns) {
      for (const event of agentRun.events) {
        if (event.id > latestId) latestId = event.id;
      }
    }
    return latestId;
  });
  const replacementRunHref = $derived(
    run.replacementRunId === null ? null : `/runs/${run.replacementRunId}`,
  );
  const checkRunHref = $derived(
    run.checkRunId === null
      ? null
      : `https://github.com/${run.repositoryOwner}/${run.repositoryName}/runs/${run.checkRunId}`,
  );

  function isDeniedToolEvent(detail: unknown): boolean {
    return (
      typeof detail === 'object' &&
      detail !== null &&
      (('denied' in detail && detail.denied === true) ||
        ('allowed' in detail && detail.allowed === false))
    );
  }

  function toDate(value: Date | string): Date {
    return value instanceof Date ? value : new Date(value);
  }

  function toDateTime(value: Date | string): string {
    const date = toDate(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
  }

  function toTimestamp(value: Date | string): string {
    const date = toDate(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
  }

  function summarizeEvent(event: AgentEvent): string {
    const base = event.tool ? `${event.kind}: ${event.tool}` : event.kind;
    return event.kind === 'tool_pre' && isDeniedToolEvent(event.detail) ? `${base} blocked` : base;
  }

  function eventSeverity(event: AgentEvent): StreamEvent['severity'] {
    if (event.kind === 'tool_pre' && isDeniedToolEvent(event.detail)) return 'warning';
    if (event.kind.includes('error') || event.kind.includes('failed')) return 'error';
    return 'info';
  }

  function toStreamEvents(events: AgentEvent[]): StreamEvent[] {
    return events.map((event) => ({
      id: String(event.id),
      datetime: toDateTime(event.at),
      timestamp: toTimestamp(event.at),
      severity: eventSeverity(event),
      source: event.tool ?? undefined,
      summary: summarizeEvent(event),
      details: event.detail ?? undefined,
    }));
  }

  function canStopAgent(status: string): boolean {
    return status === 'running' || status === 'queued';
  }

  function githubCommentHref(commentId: number): string {
    return `https://github.com/${run.repositoryOwner}/${run.repositoryName}/pull/${run.prNumber}#discussion_r${commentId}`;
  }

  $effect(() => {
    if (!canStopRun) {
      connectionState = 'disconnected';
      return;
    }

    const fallbackRefresh = window.setInterval(() => void invalidateAll(), 10_000);

    if (typeof EventSource === 'undefined') {
      connectionState = 'disconnected';
      return () => window.clearInterval(fallbackRefresh);
    }

    connectionState = 'connecting';
    const initialAgentEventId = untrack(() => latestAgentEventId);
    let streamIsActive = true;
    const eventSource = new EventSource(
      `/api/review/runs/${run.id}/events?after=${initialAgentEventId}`,
    );

    eventSource.onopen = () => {
      if (!streamIsActive) return;
      connectionState = 'streaming';
    };

    eventSource.addEventListener('agent_event', () => {
      void invalidateAll();
    });

    eventSource.onerror = () => {
      if (!streamIsActive) return;
      connectionState = 'disconnected';
    };

    return () => {
      streamIsActive = false;
      window.clearInterval(fallbackRefresh);
      eventSource.close();
    };
  });
</script>

<Page
  title={`Run ${run.id}`}
  subtitle={`${run.repositoryOwner}/${run.repositoryName} pull request #${run.prNumber}`}
>
  {#snippet actions()}
    <form method="POST" action={`/api/review/runs/${run.id}/stop`}>
      <Button type="submit" variant="danger" size="sm" disabled={!canStopRun}>
        Stop run
        {#snippet leadingIcon()}<Square size={14} aria-hidden="true" />{/snippet}
      </Button>
    </form>
  {/snippet}

  <Card>
    <div class="status-row">
      <Badge size="sm">{run.status}</Badge>
      <span class:connected class="connection-dot" aria-hidden="true"></span>
      <span aria-label="Run event stream state">{connectionLabel}</span>
      {#if run.status === 'superseded'}
        {#if replacementRunHref}
          <Link href={replacementRunHref}>Superseded by a newer run</Link>
        {:else}
          <span>Superseded by a newer run</span>
        {/if}
      {/if}
    </div>
    {#if run.error}
      <Alert variant="error">{run.error}</Alert>
    {/if}
    <dl class="run-summary">
      <div>
        <dt>Estimated cost</dt>
        <dd>${Number(run.costEstimateUsd).toFixed(2)}</dd>
      </div>
      <div>
        <dt>Check Run</dt>
        <dd>
          {#if checkRunHref}
            <Link href={checkRunHref}>Open GitHub Check Run</Link>
          {:else}
            <span>No Check Run recorded</span>
          {/if}
        </dd>
      </div>
    </dl>
  </Card>

  <div class="surface-states" aria-label="Surface states">
    {#each data.surfaceStates as state (state)}
      <Badge size="sm">{state}</Badge>
    {/each}
  </div>

  <section class="agent-grid" aria-label="Agent timelines">
    {#if run.agentRuns.length === 0}
      <Card>
        <p class="muted">No agent runs recorded.</p>
      </Card>
    {/if}
    {#each run.agentRuns as agentRun (agentRun.id)}
      <Card>
        <div class="agent-header">
          <div>
            <h2>{agentRun.slug}</h2>
            <p>{agentRun.description}</p>
          </div>
          <div class="agent-actions">
            <Badge size="sm">{agentRun.status}</Badge>
            <form
              method="POST"
              action={`/api/review/runs/${run.id}/agents/${agentRun.agentId}/stop`}
            >
              <Button
                type="submit"
                variant="danger"
                size="sm"
                disabled={!canStopAgent(agentRun.status)}
                aria-label={`Stop ${agentRun.slug}`}
              >
                Stop
                {#snippet leadingIcon()}<Square size={14} aria-hidden="true" />{/snippet}
              </Button>
            </form>
          </div>
        </div>

        <EventStreamViewer
          events={toStreamEvents(agentRun.events)}
          connectionState={canStopAgent(agentRun.status) ? eventStreamConnectionState : undefined}
          label={`${agentRun.slug} event stream`}
        />

        <details open>
          <summary>Findings</summary>
          {#if agentRun.findings.length === 0}
            <p class="muted">No findings recorded.</p>
          {:else}
            <ul class="finding-list">
              {#each agentRun.findings as finding (finding.id)}
                <li>
                  <strong>{finding.title}</strong>
                  <span>{finding.path}:{finding.startLine ?? '?'}</span>
                  {#if finding.githubCommentId}
                    <a href={githubCommentHref(finding.githubCommentId)}>GitHub comment</a>
                  {/if}
                </li>
              {/each}
            </ul>
          {/if}
        </details>
      </Card>
    {/each}
  </section>
</Page>

<style>
  .status-row,
  .agent-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
  }

  .status-row {
    justify-content: flex-start;
    color: var(--text-muted);
  }

  .agent-actions {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .run-summary {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-3);
    margin-top: var(--space-4);
  }

  .run-summary div {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    padding: var(--space-3);
    background: var(--surface-overlay);
  }

  .run-summary dt {
    color: var(--text-muted);
    font-size: var(--text-xs);
  }

  .run-summary dd {
    color: var(--text);
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
  }

  .connection-dot {
    width: 0.625rem;
    height: 0.625rem;
    border-radius: 999px;
    background: var(--danger);
  }

  .connection-dot.connected {
    background: var(--success);
  }

  .agent-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(18rem, 1fr));
    gap: var(--space-4);
  }

  .surface-states {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  h2 {
    font-size: var(--text-base);
    font-weight: var(--font-semibold);
    color: var(--text);
  }

  p,
  .muted {
    color: var(--text-muted);
  }

  .finding-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin-block: var(--space-4);
  }

  .finding-list {
    padding-left: var(--space-5);
  }

  .finding-list li {
    display: grid;
    gap: var(--space-1);
  }

  @media (max-width: 640px) {
    .run-summary {
      grid-template-columns: 1fr;
    }
  }
</style>
