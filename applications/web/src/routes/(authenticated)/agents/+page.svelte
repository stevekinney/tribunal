<script lang="ts">
  import Page from '$lib/components/page.svelte';
  import { Alert } from '@lostgradient/cinder/alert';
  import { Badge } from '@lostgradient/cinder/badge';
  import { Button } from '@lostgradient/cinder/button';
  import { Card } from '@lostgradient/cinder/card';
  import { Calculator, Pencil, Power, Save, Trash2, X } from 'lucide-svelte';
  import { untrack } from 'svelte';
  import { getEffortFallbackNotice } from '$lib/review/operator-ui';

  let { data, form } = $props();

  function getDryRunValues() {
    const values = form?.values;
    return values && 'sampleDiff' in values ? values : null;
  }

  let agentId = $state(untrack(() => form?.values?.id ?? ''));
  let slug = $state(untrack(() => form?.values?.slug ?? ''));
  let description = $state(untrack(() => form?.values?.description ?? ''));
  let body = $state(untrack(() => form?.values?.body ?? ''));
  let enabled = $state(untrack(() => form?.values?.enabled ?? true));
  let selectedModel = $state(untrack(() => form?.values?.model ?? 'sonnet'));
  let selectedEffort = $state(untrack(() => form?.values?.effort ?? ''));
  let sampleDiff = $state(untrack(() => getDryRunValues()?.sampleDiff ?? ''));
  const effectiveWarningModel = $derived.by(() => {
    const model = selectedModel === 'inherit' ? data.defaultModel : selectedModel;
    return model === 'inherit' ? null : model;
  });
  const fallbackNotice = $derived(
    effectiveWarningModel === null
      ? null
      : getEffortFallbackNotice(effectiveWarningModel, selectedEffort),
  );
  const dryRunEstimate = $derived(form?.dryRunEstimate);
  const dryRunValues = $derived(getDryRunValues());
  const isDryRunEstimateCurrent = $derived(
    dryRunEstimate &&
      dryRunValues &&
      dryRunValues.body === body &&
      dryRunValues.sampleDiff === sampleDiff &&
      dryRunValues.model === selectedModel &&
      dryRunValues.effort === selectedEffort,
  );
  let bodyTextarea: HTMLTextAreaElement | undefined = $state();

  function editAgent(agent: (typeof data.agents)[number]) {
    agentId = agent.id;
    slug = agent.slug;
    description = agent.description;
    body = agent.body;
    selectedModel = agent.model;
    selectedEffort = agent.effort ?? '';
    sampleDiff = '';
    enabled = agent.enabled;
  }

  function resetForm() {
    agentId = '';
    slug = '';
    description = '';
    body = '';
    selectedModel = 'sonnet';
    selectedEffort = '';
    sampleDiff = '';
    enabled = true;
  }

  function clearBodyValidation() {
    bodyTextarea?.setCustomValidity('');
  }

  function validateDryRunPrompt(event: SubmitEvent) {
    clearBodyValidation();
    if (body.trim() !== '') return;
    event.preventDefault();
    bodyTextarea?.setCustomValidity('System prompt is required for a dry run estimate.');
    bodyTextarea?.reportValidity();
  }
</script>

<Page title="Agents" subtitle="Reusable read-only review agents">
  {#if form?.error}
    <Alert variant="error">{form.error}</Alert>
  {/if}

  <Card>
    <form method="POST" action="?/save" class="agent-form" id="agent-save-form">
      <input type="hidden" name="id" value={agentId} />
      <label class="field">
        <span>Slug</span>
        <input
          name="slug"
          bind:value={slug}
          required
          pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
          placeholder="security-review"
        />
      </label>
      <label class="field">
        <span>Description</span>
        <input
          name="description"
          bind:value={description}
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
        <textarea
          bind:this={bodyTextarea}
          name="body"
          rows="8"
          required
          bind:value={body}
          oninput={clearBodyValidation}
        ></textarea>
      </label>
      <label class="enabled-control">
        <input type="checkbox" name="enabled" bind:checked={enabled} />
        <span>Enabled</span>
      </label>
      <div class="form-actions">
        <Button type="submit" variant="primary">
          {agentId ? 'Update agent' : 'Save agent'}
          {#snippet leadingIcon()}<Save size={14} aria-hidden="true" />{/snippet}
        </Button>
        {#if agentId}
          <Button type="button" variant="secondary" onclick={resetForm}>
            Cancel
            {#snippet leadingIcon()}<X size={14} aria-hidden="true" />{/snippet}
          </Button>
        {/if}
      </div>
    </form>

    <form method="POST" action="?/dryRun" class="dry-run-form" onsubmit={validateDryRunPrompt}>
      <input type="hidden" name="id" value={agentId} />
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="description" value={description} />
      <input type="hidden" name="body" value={body} />
      <input type="hidden" name="model" value={selectedModel} />
      <input type="hidden" name="effort" value={selectedEffort} />
      <input type="hidden" name="enabled" value={enabled ? 'on' : ''} />

      <label class="field">
        <span>Sample diff</span>
        <textarea
          name="sampleDiff"
          rows="6"
          required
          bind:value={sampleDiff}
          placeholder="diff --git a/src/example.ts b/src/example.ts"
        ></textarea>
      </label>

      {#if dryRunEstimate && isDryRunEstimateCurrent}
        <div class="dry-run-result" role="status" aria-live="polite" aria-atomic="true">
          <div>
            <span>Estimated cost</span>
            <strong>${dryRunEstimate.costEstimateUsd.toFixed(4)}</strong>
          </div>
          <div>
            <span>Model</span>
            <strong>{dryRunEstimate.model}</strong>
          </div>
          <div>
            <span>Input</span>
            <strong>{dryRunEstimate.estimatedInputTokens} input tokens</strong>
          </div>
          <div>
            <span>Output</span>
            <strong>{dryRunEstimate.estimatedOutputTokens} output tokens</strong>
          </div>
        </div>
      {/if}

      <div class="form-actions">
        <Button type="submit" variant="secondary">
          Dry run estimate
          {#snippet leadingIcon()}<Calculator size={14} aria-hidden="true" />{/snippet}
        </Button>
      </div>
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
            <div class="row-actions">
              <Button type="button" variant="secondary" onclick={() => editAgent(agent)}>
                Edit
                {#snippet leadingIcon()}<Pencil size={14} aria-hidden="true" />{/snippet}
              </Button>
              <form method="POST" action="?/setEnabled">
                <input type="hidden" name="id" value={agent.id} />
                <input type="hidden" name="enabled" value={agent.enabled ? 'false' : 'true'} />
                <Button type="submit" variant="secondary">
                  {agent.enabled ? 'Disable' : 'Enable'}
                  {#snippet leadingIcon()}<Power size={14} aria-hidden="true" />{/snippet}
                </Button>
              </form>
              <form method="POST" action="?/delete">
                <input type="hidden" name="id" value={agent.id} />
                <Button type="submit" variant="danger">
                  Delete
                  {#snippet leadingIcon()}<Trash2 size={14} aria-hidden="true" />{/snippet}
                </Button>
              </form>
            </div>
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

  .dry-run-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    margin-top: var(--space-4);
    border-top: 1px solid var(--border);
    padding-top: var(--space-4);
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

  .form-actions,
  .row-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
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

  .dry-run-result {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    padding: var(--space-3);
    background: var(--surface-overlay);
  }

  .dry-run-result div {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .dry-run-result span {
    color: var(--text-muted);
    font-size: var(--text-xs);
  }

  .dry-run-result strong {
    color: var(--text);
    font-size: var(--text-sm);
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

    .dry-run-result {
      grid-template-columns: 1fr;
    }
  }
</style>
