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
    <div class="inspector-grid">
      <Card>
        <h2>Step timeline</h2>
        <p class="muted">Waiting for Weft tail events.</p>
      </Card>
      <Card>
        <h2>Signals and timers</h2>
        <p class="muted">No signals or timers are currently loaded.</p>
      </Card>
      <Card>
        <h2>Child tree</h2>
        <p class="muted">No child workflows are currently loaded.</p>
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

  .muted {
    color: var(--text-muted);
  }
</style>
