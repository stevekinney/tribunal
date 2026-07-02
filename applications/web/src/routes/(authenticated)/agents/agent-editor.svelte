<script lang="ts">
  import { getEffortFallbackNotice } from '$lib/review/operator-ui';
  import { Alert } from '@lostgradient/cinder/alert';
  import { Button } from '@lostgradient/cinder/button';
  import { Card } from '@lostgradient/cinder/card';
  import { Input } from '@lostgradient/cinder/input';
  import { MarkdownEditor } from '@lostgradient/cinder/markdown-editor';
  import { Select } from '@lostgradient/cinder/select';
  import { Toggle } from '@lostgradient/cinder/toggle';
  import Save from 'lucide-svelte/icons/save';
  import { untrack } from 'svelte';
  import { enhance } from '$app/forms';

  type AgentFormValue = {
    id?: string;
    slug: string;
    description: string;
    body: string;
    model: string;
    effort: string | null;
    enabled: boolean;
  };

  type Props = {
    agent: AgentFormValue;
    defaultModel: string;
    modelOptions: readonly string[];
    effortOptions: readonly string[];
    form?: { error?: string; values?: Partial<AgentFormValue> } | null;
    submitLabel: string;
  };

  let {
    agent,
    defaultModel,
    modelOptions,
    effortOptions,
    form = null,
    submitLabel,
  }: Props = $props();

  let slug = $state(untrack(() => form?.values?.slug ?? agent.slug));
  let description = $state(untrack(() => form?.values?.description ?? agent.description));
  let body = $state(untrack(() => form?.values?.body ?? agent.body));
  let enabled = $state(untrack(() => form?.values?.enabled ?? agent.enabled));
  let selectedModel = $state(untrack(() => form?.values?.model ?? agent.model));
  let selectedEffort = $state(untrack(() => form?.values?.effort ?? agent.effort ?? ''));
  let editorMode = $state<'source' | 'wysiwyg'>('source');

  const modelSelectOptions = $derived(
    modelOptions.map((model) => ({
      value: model,
      label: model === 'inherit' ? `Inherit default (${defaultModel})` : model,
    })),
  );
  const effortSelectOptions = $derived([
    { value: '', label: 'Default' },
    ...effortOptions.map((effort) => ({ value: effort, label: effort })),
  ]);
  const effectiveWarningModel = $derived(
    selectedModel === 'inherit' ? defaultModel : selectedModel,
  );
  const fallbackNotice = $derived(getEffortFallbackNotice(effectiveWarningModel, selectedEffort));
</script>

{#if form?.error}
  <Alert variant="danger">{form.error}</Alert>
{/if}

<form method="POST" action="?/save" class="agent-form" use:enhance>
  {#if agent.id}
    <input type="hidden" name="id" value={agent.id} />
  {/if}
  <input type="hidden" name="body" value={body} />

  <Card title="Agent identity" headingLevel={2}>
    <div class="field-grid">
      <Input
        id="agent-slug"
        name="slug"
        label="Slug"
        bind:value={slug}
        required
        pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
        placeholder="security-review"
        description="Lowercase with dashes. Identifies this agent in pull request comments."
      />
      <Input
        id="agent-description"
        name="description"
        label="Description"
        bind:value={description}
        required
        placeholder="Finds authentication and permission issues"
      />
    </div>
  </Card>

  <Card title="Prompt" description="Markdown is supported." headingLevel={2}>
    <MarkdownEditor
      id="agent-body"
      label="System prompt"
      bind:value={body}
      bind:mode={editorMode}
      showToolbar
      showModeToggle
      placeholder="Describe what this agent should look for in every pull request..."
    />
  </Card>

  <Card title="Runtime" headingLevel={2}>
    <div class="runtime-grid">
      <Select
        id="agent-model"
        name="model"
        label="Model"
        bind:value={selectedModel}
        options={modelSelectOptions}
      />
      <div class="effort-field">
        <Select
          id="agent-effort"
          name="effort"
          label="Effort"
          bind:value={selectedEffort}
          options={effortSelectOptions}
        />
        <p>Higher effort uses more tokens per review.</p>
      </div>
    </div>

    {#if fallbackNotice}
      <Alert variant="warning">{fallbackNotice}</Alert>
    {/if}

    <div class="enabled-row">
      <div>
        <span class="enabled-label">Enabled</span>
        <p>Runs on watched repositories.</p>
      </div>
      <Toggle id="agent-enabled" label="Enabled" name="enabled" bind:checked={enabled} />
    </div>
  </Card>

  <div class="form-actions">
    <Button type="submit" variant="primary">
      {#snippet leadingIcon()}<Save size={14} aria-hidden="true" />{/snippet}
      {submitLabel}
    </Button>
  </div>
</form>

<style>
  .agent-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .field-grid,
  .runtime-grid {
    display: grid;
    gap: var(--space-4);
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .effort-field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .enabled-label {
    color: var(--text);
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
  }

  .effort-field p,
  .enabled-row p {
    color: var(--text-subtle);
    font-size: var(--text-sm);
    margin: 0;
  }

  .enabled-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    margin-top: var(--space-4);
  }

  .form-actions {
    display: flex;
    justify-content: flex-end;
  }

  @media (max-width: 760px) {
    .field-grid,
    .runtime-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
