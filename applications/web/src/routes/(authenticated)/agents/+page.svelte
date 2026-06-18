<script lang="ts">
  import Page from '$lib/components/page.svelte';
  import { Alert } from '@lostgradient/cinder/alert';
  import { Badge } from '@lostgradient/cinder/badge';
  import { Button } from '@lostgradient/cinder/button';
  import { Card } from '@lostgradient/cinder/card';
  import { Save } from 'lucide-svelte';
  import { getEffortFallbackNotice } from '$lib/review/operator-ui';

  let { data, form } = $props();

  let selectedModel = $state('sonnet');
  let selectedEffort = $state('xhigh');
  const fallbackNotice = $derived(getEffortFallbackNotice(selectedModel, selectedEffort));
</script>

<Page title="Agents" subtitle="Reusable read-only review agents">
  {#if form?.error}
    <Alert variant="error">{form.error}</Alert>
  {/if}

  <Card>
    <form method="POST" action="?/save" class="agent-form">
      <input type="hidden" name="id" value="" />
      <label class="field">
        <span>Slug</span>
        <input
          name="slug"
          required
          pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
          placeholder="security-review"
        />
      </label>
      <label class="field">
        <span>Description</span>
        <input
          name="description"
          required
          placeholder="Finds authentication and permission issues"
        />
      </label>
      <label class="field">
        <span>Model</span>
        <select name="model" bind:value={selectedModel}>
          {#each data.modelOptions as model (model)}
            <option value={model}>{model}</option>
          {/each}
        </select>
      </label>
      <label class="field">
        <span>Effort</span>
        <select name="effort" bind:value={selectedEffort}>
          <option value="">Default</option>
          {#each data.effortOptions as effort (effort)}
            <option value={effort}>{effort}</option>
          {/each}
        </select>
      </label>
      {#if fallbackNotice}
        <Alert variant="warning">{fallbackNotice}</Alert>
      {/if}
      <label class="field field-wide">
        <span>System prompt</span>
        <textarea name="body" rows="8" required></textarea>
      </label>
      <label class="enabled-control">
        <input type="checkbox" name="enabled" checked />
        <span>Enabled</span>
      </label>
      <Button type="submit" variant="primary">
        Save agent
        {#snippet leadingIcon()}<Save size={14} aria-hidden="true" />{/snippet}
      </Button>
    </form>
  </Card>

  {#if data.agents.length === 0}
    <Card>
      <p class="muted">No agents have been created yet.</p>
    </Card>
  {:else}
    <ul class="agent-list">
      {#each data.agents as agent (agent.id)}
        <li>
          <Card>
            <div class="agent-row">
              <div>
                <h2>{agent.slug}</h2>
                <p>{agent.description}</p>
              </div>
              <div class="agent-badges">
                <Badge size="sm">{agent.model}</Badge>
                {#if agent.effort}<Badge size="sm">{agent.effort}</Badge>{/if}
                <Badge size="sm">{agent.enabled ? 'Enabled' : 'Disabled'}</Badge>
              </div>
            </div>
            <details>
              <summary>Prompt</summary>
              <pre>{agent.body}</pre>
            </details>
          </Card>
        </li>
      {/each}
    </ul>
  {/if}
</Page>

<style>
  .agent-form {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-4);
  }

  .field,
  .enabled-control {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    color: var(--text-muted);
    font-size: var(--text-sm);
  }

  .enabled-control {
    flex-direction: row;
    align-items: center;
    color: var(--text);
  }

  .field-wide {
    grid-column: 1 / -1;
  }

  input,
  select,
  textarea {
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface);
    color: var(--text);
    padding: var(--space-2) var(--space-3);
    font: inherit;
  }

  .agent-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    list-style: none;
  }

  .agent-row {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-4);
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

  .agent-badges {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--space-2);
  }

  pre {
    overflow: auto;
    margin-top: var(--space-3);
    padding: var(--space-3);
    border-radius: var(--radius-md);
    background: var(--surface-overlay);
    color: var(--text);
    white-space: pre-wrap;
  }

  @media (max-width: 640px) {
    .agent-form {
      grid-template-columns: 1fr;
    }

    .agent-row {
      flex-direction: column;
    }
  }
</style>
