<script lang="ts">
  import Page from '$lib/components/page.svelte';
  import { Badge } from '@lostgradient/cinder/badge';
  import { Card } from '@lostgradient/cinder/card';
  import { Link } from '@lostgradient/cinder/link';
  import { formatDuration } from '$lib/utilities/format-duration';

  let { data } = $props();
</script>

<Page title="Runs" subtitle="Recent review runs">
  {#if data.runs.length === 0}
    <Card><p class="muted">No review runs have started yet.</p></Card>
  {:else}
    <Card padding="none">
      <div class="run-table" role="table" aria-label="Review runs">
        <div class="run-row run-header" role="row">
          <span role="columnheader">Pull request</span>
          <span role="columnheader">Status</span>
          <span role="columnheader">Trigger</span>
          <span role="columnheader">Findings</span>
          <span role="columnheader">Estimate</span>
          <span role="columnheader">Duration</span>
        </div>
        {#each data.runs as run (run.id)}
          <Link href={`/runs/${run.id}`} class="run-row" role="row">
            <span role="cell">{run.repositoryOwner}/{run.repositoryName} #{run.prNumber}</span>
            <span role="cell"><Badge size="sm">{run.status}</Badge></span>
            <span role="cell">{run.trigger}</span>
            <span role="cell">{run.commentsPosted}</span>
            <span role="cell">${Number(run.costEstimateUsd).toFixed(2)}</span>
            <span role="cell">{formatDuration(run.startedAt, run.finishedAt)}</span>
          </Link>
        {/each}
      </div>
    </Card>
  {/if}
</Page>

<style>
  .muted {
    color: var(--text-muted);
  }

  .run-table {
    display: grid;
  }

  .run-row {
    display: grid;
    grid-template-columns: minmax(12rem, 2fr) repeat(5, minmax(6rem, 1fr));
    gap: var(--space-3);
    align-items: center;
    padding: var(--space-3) var(--space-4);
    border-bottom: 1px solid var(--border-muted);
    color: var(--text);
  }

  .run-header {
    color: var(--text-muted);
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
  }

  @media (max-width: 760px) {
    .run-row {
      grid-template-columns: 1fr;
    }

    .run-header {
      display: none;
    }
  }
</style>
