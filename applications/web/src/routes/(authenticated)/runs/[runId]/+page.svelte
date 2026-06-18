<script lang="ts">
  import Page from '$lib/components/page.svelte';
  import { Alert } from '@lostgradient/cinder/alert';
  import { Badge } from '@lostgradient/cinder/badge';
  import { Button } from '@lostgradient/cinder/button';
  import { Card } from '@lostgradient/cinder/card';
  import { Link } from '@lostgradient/cinder/link';
  import { Square } from 'lucide-svelte';

  let { data } = $props();

  const run = $derived(data.run);
  const connected = $derived(run.status === 'running' || run.status === 'queued');

  function isDeniedToolEvent(detail: unknown): boolean {
    return typeof detail === 'object' && detail !== null && 'denied' in detail;
  }
</script>

<Page
  title={`Run ${run.id}`}
  subtitle={`${run.repositoryOwner}/${run.repositoryName} pull request #${run.prNumber}`}
>
  {#snippet actions()}
    <form method="POST" action={`/api/review/runs/${run.id}/stop`}>
      <Button type="submit" variant="danger" size="sm">
        Stop
        {#snippet leadingIcon()}<Square size={14} aria-hidden="true" />{/snippet}
      </Button>
    </form>
  {/snippet}

  <Card>
    <div class="status-row">
      <Badge size="sm">{run.status}</Badge>
      <span class:connected class="connection-dot" aria-hidden="true"></span>
      <span>{connected ? 'Streaming' : 'Disconnected'}</span>
      {#if run.status === 'superseded'}
        <Link href="/runs">Superseded by a newer run</Link>
      {/if}
    </div>
    {#if run.error}
      <Alert variant="error">{run.error}</Alert>
    {/if}
  </Card>

  <section class="agent-grid" aria-label="Agent timelines">
    {#each run.agentRuns as agentRun (agentRun.id)}
      <Card>
        <div class="agent-header">
          <div>
            <h2>{agentRun.slug}</h2>
            <p>{agentRun.description}</p>
          </div>
          <Badge size="sm">{agentRun.status}</Badge>
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

        <details>
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
                    <a href={`#comment-${finding.githubCommentId}`}>GitHub comment</a>
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
</style>
