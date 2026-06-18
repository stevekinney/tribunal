<script lang="ts">
  import Page from '$lib/components/page.svelte';
  import { Alert } from '@lostgradient/cinder/alert';
  import { Button } from '@lostgradient/cinder/button';
  import { Card } from '@lostgradient/cinder/card';
  import { Save } from 'lucide-svelte';

  let { data, form } = $props();
</script>

<Page title="Settings" subtitle="Review safety controls">
  {#if form?.error}
    <Alert variant="error">{form.error}</Alert>
  {/if}

  <Card>
    <form method="POST" action="?/save" class="settings-form">
      <label class="field">
        <span>Daily cost cap</span>
        <input
          type="number"
          name="dailyCostCapUsd"
          min="0"
          step="0.01"
          value={data.settings.dailyCostCapUsd}
          required
        />
      </label>
      <label class="field">
        <span>Default model</span>
        <select name="defaultModel">
          {#each data.modelOptions as model (model)}
            <option value={model} selected={model === data.settings.defaultModel}>{model}</option>
          {/each}
        </select>
      </label>
      <label class="kill-switch">
        <input type="checkbox" name="reviewsEnabled" checked={data.settings.reviewsEnabled} />
        <span>Reviews enabled</span>
      </label>
      <p class="muted">Reconciliation status: waiting for authoritative cost events.</p>
      <Button type="submit" variant="primary">
        Save settings
        {#snippet leadingIcon()}<Save size={14} aria-hidden="true" />{/snippet}
      </Button>
    </form>
  </Card>
</Page>

<style>
  .settings-form {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-4);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    color: var(--text-muted);
    font-size: var(--text-sm);
  }

  .kill-switch {
    grid-column: 1 / -1;
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--text);
  }

  input,
  select {
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface);
    color: var(--text);
    padding: var(--space-2) var(--space-3);
    font: inherit;
  }

  .muted {
    grid-column: 1 / -1;
    color: var(--text-muted);
  }

  @media (max-width: 640px) {
    .settings-form {
      grid-template-columns: 1fr;
    }
  }
</style>
