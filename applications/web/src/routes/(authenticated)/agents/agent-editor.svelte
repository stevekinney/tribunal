<script lang="ts" module>
  /**
   * DOM id of the agent form. The page header renders the Enabled checkbox
   * outside this component (see agents/[agentId]/+page.svelte and
   * agents/new/+page.svelte) — a submit-deferred checkbox, not a switch, since
   * this value only takes effect on Save. It associates with this form via the
   * native HTML `form` attribute rather than living inside it.
   */
  export const AGENT_EDITOR_FORM_ID = 'agent-editor-form';
</script>

<script lang="ts">
  import { getEffortFallbackNotice } from '$lib/review/operator-ui';
  import { Alert } from '@lostgradient/cinder/alert';
  import { Button } from '@lostgradient/cinder/button';
  import { Card } from '@lostgradient/cinder/card';
  import { Input } from '@lostgradient/cinder/input';
  import { MarkdownEditor } from '@lostgradient/editor/markdown-editor';
  import { Select } from '@lostgradient/cinder/select';
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
  let selectedModel = $state(untrack(() => form?.values?.model ?? agent.model));
  let selectedEffort = $state(untrack(() => form?.values?.effort ?? agent.effort ?? ''));

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
  const currentAgentId = $derived(form?.values?.id ?? agent.id);
</script>

{#if form?.error}
  <Alert variant="danger">{form.error}</Alert>
{/if}

<form id={AGENT_EDITOR_FORM_ID} method="POST" action="?/save" class="agent-form" use:enhance>
  {#if currentAgentId}
    <input type="hidden" name="id" value={currentAgentId} />
  {/if}
  <input type="hidden" name="body" value={body} />

  <Card title="Identity" headingLevel={2}>
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

  <Card>
    <MarkdownEditor
      id="agent-body"
      label="System prompt"
      bind:value={body}
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
      <Select
        id="agent-effort"
        name="effort"
        label="Effort"
        bind:value={selectedEffort}
        options={effortSelectOptions}
      />
    </div>

    {#if fallbackNotice}
      <Alert variant="warning">{fallbackNotice}</Alert>
    {/if}
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
