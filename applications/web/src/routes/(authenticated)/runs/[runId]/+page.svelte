<script lang="ts">
  import Page from '$lib/components/page.svelte';
  import { Alert } from '@lostgradient/cinder/alert';
  import { Badge } from '@lostgradient/cinder/badge';
  import { Button } from '@lostgradient/cinder/button';
  import { Card } from '@lostgradient/cinder/card';
  import { Link } from '@lostgradient/cinder/link';
  import { invalidateAll } from '$app/navigation';
  import { Square } from 'lucide-svelte';

  let { data } = $props();

  const run = $derived(data.run);
  let connectionState = $state<'connecting' | 'streaming' | 'disconnected'>('disconnected');
  const canStopRun = $derived(run.status === 'running' || run.status === 'queued');
  const connected = $derived(canStopRun && connectionState === 'streaming');
  const connectionLabel = $derived(canStopRun ? connectionState : 'disconnected');
  const latestAgentEventId = $derived(
    Math.max(0, ...run.agentRuns.flatMap((agentRun) => agentRun.events.map((event) => event.id))),
  );
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

  function canStopAgent(status: string): boolean {
    return status === 'running' || status === 'queued';
  }

  function githubCommentHref(commentId: number): string {
    return `https://github.com/${run.repositoryOwner}/${run.repositoryName}/pull/${run.prNumber}#discussion_r${commentId}`;
  }

  $effect(() => {
    if (!canStopRun || typeof EventSource === 'undefined') {
      connectionState = 'disconnected';
      return;
    }

    connectionState = 'connecting';
    const eventSource = new EventSource(
      `/api/review/runs/${run.id}/events?after=${latestAgentEventId}`,
    );

    eventSource.onopen = () => {
      connectionState = 'streaming';
    };

    eventSource.addEventListener('agent_event', () => {
      void invalidateAll();
    });

    eventSource.onerror = () => {
      connectionState = 'disconnected';
    };

    return () => {
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

        <ol class="timeline">
          {#each agentRun.events as event (event.id)}
            <li>
              <span>{event.kind}</span>
              {#if event.tool}<strong>{event.tool}</strong>{/if}
              <small>{new Date(event.at).toLocaleString()}</small>
              {#if event.kind === 'tool_pre' && isDeniedToolEvent(event.detail)}
                <Badge size="sm">blocked</Badge>
              {/if}
            </li>
          {/each}
        </ol>

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
  .muted,
  small {
    color: var(--text-muted);
  }

  .timeline,
  .finding-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin-block: var(--space-4);
    padding-left: var(--space-5);
  }

  .timeline li,
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
