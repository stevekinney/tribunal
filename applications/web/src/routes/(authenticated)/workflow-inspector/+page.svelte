<script lang="ts">
  import Page from '$lib/components/page.svelte';
  import { Alert } from '@lostgradient/cinder/alert';
  import { Card } from '@lostgradient/cinder/card';

  let { data } = $props();
</script>

<Page title="Workflow Inspector" subtitle="Durable Weft workflow state">
  {#if !data.enabled}
    <Alert variant="warning">Workflow inspector is hidden.</Alert>
  {:else}
    <div class="surface-states" aria-label="Surface states">
      {#each data.surfaceStates as state (state)}
        <span>{state}</span>
      {/each}
    </div>
    <div class="inspector-grid">
      <Card>
        <h2>Step timeline</h2>
        {#if data.runs.length === 0}
          <p class="muted">No review workflows recorded.</p>
        {:else}
          <ol>
            {#each data.runs.slice(0, 10) as run (run.id)}
              <li>
                <strong>{run.status}</strong>
                <span>{run.repositoryOwner}/{run.repositoryName} #{run.prNumber}</span>
              </li>
            {/each}
          </ol>
        {/if}
      </Card>
      <Card>
        <h2>Signals and timers</h2>
        <p class="muted">
          {data.runs.filter((run) => run.status === 'running' || run.status === 'queued').length}
          active workflow signals.
        </p>
      </Card>
      <Card>
        <h2>Child tree</h2>
        <p class="muted">{data.runs.length} review workflow records loaded.</p>
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

  .surface-states span {
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: var(--space-1) var(--space-2);
    color: var(--text-muted);
  }

  ol {
    display: grid;
    gap: var(--space-2);
    padding-left: var(--space-5);
  }

  .muted {
    color: var(--text-muted);
  }
</style>
