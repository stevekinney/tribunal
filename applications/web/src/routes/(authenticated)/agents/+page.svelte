<script lang="ts">
  import Page from '$lib/components/page.svelte';
  import { Alert } from '@lostgradient/cinder/alert';
  import { Badge } from '@lostgradient/cinder/badge';
  import { Button } from '@lostgradient/cinder/button';
  import { Card } from '@lostgradient/cinder/card';
  import { Input } from '@lostgradient/cinder/input';
  import { Select } from '@lostgradient/cinder/select';
  import { StatusDot } from '@lostgradient/cinder/status-dot';
  import { Textarea } from '@lostgradient/cinder/textarea';
  import { Toggle } from '@lostgradient/cinder/toggle';
  import {
    Calculator,
    FileText,
    GitPullRequest,
    Info,
    Pencil,
    Power,
    Save,
    Trash2,
    X,
  } from 'lucide-svelte';
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
  const sampleDiffPlaceholder =
    'diff --git a/src/auth.ts b/src/auth.ts\n--- a/src/auth.ts\n+++ b/src/auth.ts';
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

  // IDE layout derivations
  const lineCount = $derived(body ? body.split('\n').length : 1);
  const lineNumbers = $derived(Array.from({ length: lineCount }, (_, i) => i + 1).join('\n'));
  const modelSelectOptions = $derived(
    data.modelOptions.map((m: string) => ({ value: m, label: m })),
  );
  const selectedAgent = $derived(data.agents.find((a: { id: string }) => a.id === agentId) ?? null);
  const hasUnsavedChanges = $derived(
    agentId !== '' &&
      (slug !== (selectedAgent?.slug ?? '') ||
        description !== (selectedAgent?.description ?? '') ||
        body !== (selectedAgent?.body ?? '') ||
        selectedModel !== (selectedAgent?.model ?? 'sonnet') ||
        selectedEffort !== (selectedAgent?.effort ?? '') ||
        enabled !== (selectedAgent?.enabled ?? true)),
  );
</script>

<Page title="Agents" subtitle="Reusable read-only review agents">
  {#if form?.error}
    <Alert variant="danger">{form.error}</Alert>
  {/if}

  <!--
    Save form wraps the entire IDE editor so all visible controls are natural
    descendants and native browser required-validation + focus management work
    without needing to scatter form= attributes. The dry-run form is a sibling;
    its visible controls (sampleDiff textarea, estimate button) live inside this
    form's DOM but carry form="dry-run-form" so the browser owns them correctly.
  -->
  <form id="agent-save-form" method="POST" action="?/save" class="editor-form">
    <input type="hidden" name="id" value={agentId} />

    <!-- Header bar: breadcrumb / slug · status badge · unsaved hint · actions -->
    <div class="editor-header">
      <div class="editor-breadcrumb">
        <span class="breadcrumb-section">Agents</span>
        <span class="breadcrumb-sep" aria-hidden="true">/</span>
        <span class="breadcrumb-slug">{slug || 'new agent'}</span>
        <Badge variant={enabled ? 'success' : 'neutral'} size="sm">
          <StatusDot
            status={enabled ? 'success' : 'offline'}
            label={enabled ? 'Enabled' : 'Disabled'}
          />
          {enabled ? 'Enabled' : 'Disabled'}
        </Badge>
        {#if hasUnsavedChanges}
          <span class="unsaved-hint" aria-live="polite">· unsaved changes</span>
        {/if}
      </div>

      <div class="header-actions">
        {#if agentId}
          <Button type="button" variant="ghost" size="sm" onclick={resetForm}>
            Cancel
            {#snippet leadingIcon()}<X size={14} aria-hidden="true" />{/snippet}
          </Button>
        {/if}
        <Button type="submit" variant="primary" size="sm">
          {agentId ? 'Save changes' : 'Save agent'}
          {#snippet leadingIcon()}<Save size={14} aria-hidden="true" />{/snippet}
        </Button>
      </div>
    </div>

    <!-- Two-column body: prompt editor left, settings rail right -->
    <div class="editor-body">
      <!-- LEFT: system prompt editor with line-number gutter -->
      <div class="prompt-editor">
        <div class="prompt-toolbar" aria-hidden="true">
          <span class="prompt-toolbar-title">
            <FileText size={14} />
            System prompt
          </span>
          <span class="prompt-toolbar-hint">what this agent looks for on every PR</span>
          <span class="prompt-line-count"
            >{lineCount}
            {lineCount === 1 ? 'line' : 'lines'}</span
          >
        </div>

        <div class="prompt-content">
          <!-- Static line-number column; aria-hidden so screen readers skip it -->
          <pre class="line-gutter" aria-hidden="true">{lineNumbers}</pre>
          <textarea
            id="agent-body"
            aria-label="System prompt"
            name="body"
            class="prompt-textarea"
            spellcheck={false}
            required
            placeholder="Describe what this agent should look for in every pull request…"
            bind:this={bodyTextarea}
            bind:value={body}
            oninput={clearBodyValidation}
          ></textarea>
        </div>

        <div class="prompt-footer" aria-hidden="true">
          <span class="prompt-note">
            <Info size={13} />
            Markdown supported in comments
          </span>
          <span class="prompt-note">
            <GitPullRequest size={13} />
            Runs read-only — never pushes code
          </span>
        </div>
      </div>

      <!-- RIGHT: settings rail -->
      <aside class="settings-rail" aria-label="Agent settings">
        <!-- Identity fields -->
        <div class="rail-section">
          <Input
            id="agent-slug"
            name="slug"
            label="Slug"
            bind:value={slug}
            required
            pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
            placeholder="security-review"
            description="Lowercase with dashes. Identifies this agent in PR comments."
            style="font-family: var(--font-mono);"
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

        <hr class="rail-divider" />

        <!-- Model, effort, enabled -->
        <div class="rail-section">
          <Select
            id="agent-model"
            name="model"
            label="Model"
            bind:value={selectedModel}
            options={modelSelectOptions}
          />

          <div class="effort-field">
            <label for="agent-effort">Effort</label>
            <select id="agent-effort" name="effort" bind:value={selectedEffort}>
              <option value="">Default</option>
              {#each data.effortOptions as effort (effort)}
                <option value={effort}>{effort}</option>
              {/each}
            </select>
            <p class="effort-description">Higher effort uses more tokens per review.</p>
          </div>

          {#if fallbackNotice}
            <Alert variant="warning">{fallbackNotice}</Alert>
          {/if}

          <!-- Enabled toggle row -->
          <div class="enabled-row">
            <div class="enabled-copy">
              <span class="enabled-label">Enabled</span>
              <span class="enabled-description">Runs on all watched repositories</span>
            </div>
            <Toggle
              id="agent-enabled"
              label="Enabled"
              hideLabel
              name="enabled"
              bind:checked={enabled}
            />
          </div>
        </div>

        <hr class="rail-divider" />

        <!-- Dry run card: cost estimator against a sample diff -->
        <Card variant="well">
          {#snippet header()}
            <div class="dry-run-header">
              <span class="dry-run-title">
                <Calculator size={14} aria-hidden="true" />
                Dry run
              </span>
              <Badge size="xs" variant="neutral">No charge</Badge>
            </div>
          {/snippet}

          <div class="dry-run-body">
            <!--
              This Textarea and the estimate Button carry form="dry-run-form"
              so they are owned by the dry-run sibling form even though they
              sit inside the save form's DOM subtree. This is valid HTML.
            -->
            <Textarea
              id="agent-sample-diff"
              name="sampleDiff"
              form="dry-run-form"
              label="Sample diff"
              bind:value={sampleDiff}
              required
              rows={5}
              placeholder={sampleDiffPlaceholder}
            />

            <Button type="submit" form="dry-run-form" variant="secondary" style="width: 100%;">
              Dry run estimate
              {#snippet leadingIcon()}<Calculator size={14} aria-hidden="true" />{/snippet}
            </Button>

            {#if dryRunEstimate && isDryRunEstimateCurrent}
              <div class="dry-run-results" role="status" aria-live="polite" aria-atomic="true">
                <div class="dry-run-stat">
                  <span class="stat-label">Est. cost</span>
                  <strong class="stat-value">${dryRunEstimate.costEstimateUsd.toFixed(4)}</strong>
                </div>
                <div class="dry-run-stat">
                  <span class="stat-label">Model</span>
                  <strong class="stat-value">{dryRunEstimate.model}</strong>
                </div>
                <div class="dry-run-stat">
                  <span class="stat-label">Input</span>
                  <strong class="stat-value mono"
                    >{dryRunEstimate.estimatedInputTokens} input tokens</strong
                  >
                </div>
                <div class="dry-run-stat">
                  <span class="stat-label">Output</span>
                  <strong class="stat-value mono"
                    >{dryRunEstimate.estimatedOutputTokens} output tokens</strong
                  >
                </div>
              </div>
            {/if}
          </div>
        </Card>
      </aside>
    </div>
  </form>

  <!--
    Dry-run form: sibling of the save form. Holds hidden mirror inputs that
    carry the current editor values so the ?/dryRun action receives a full
    snapshot of the (potentially unsaved) agent configuration. The visible
    sampleDiff Textarea and estimate Button above point here via form=.
  -->
  <form
    id="dry-run-form"
    method="POST"
    action="?/dryRun"
    onsubmit={validateDryRunPrompt}
    style="display: none;"
    aria-hidden="true"
  >
    <input type="hidden" name="id" value={agentId} />
    <input type="hidden" name="slug" value={slug} />
    <input type="hidden" name="description" value={description} />
    <input type="hidden" name="body" value={body} />
    <input type="hidden" name="model" value={selectedModel} />
    <input type="hidden" name="effort" value={selectedEffort} />
    <input type="hidden" name="enabled" value={enabled ? 'on' : ''} />
  </form>

  <!-- Agent list -->
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
              <div class="agent-info">
                <h2 class="agent-slug">{agent.slug}</h2>
                <p class="agent-description">{agent.description}</p>
              </div>
              <div class="agent-badges">
                <Badge size="sm">{agent.model}</Badge>
                {#if agent.effort}<Badge size="sm">{agent.effort}</Badge>{/if}
                <Badge size="sm" variant={agent.enabled ? 'success' : 'neutral'}>
                  {agent.enabled ? 'Enabled' : 'Disabled'}
                </Badge>
              </div>
            </div>
            <details>
              <summary>Prompt</summary>
              <pre class="agent-prompt">{agent.body}</pre>
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
  /* ===== IDE editor panel ===== */

  .editor-form {
    display: flex;
    flex-direction: column;
    border: 1px solid var(--border-muted);
    border-radius: var(--radius-lg);
    overflow: hidden;
    background: var(--surface);
  }

  /* --- Header bar --- */

  .editor-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-4);
    border-bottom: 1px solid var(--border-muted);
    background: var(--surface-raised);
  }

  .editor-breadcrumb {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex: 1;
    min-width: 0;
    overflow: hidden;
  }

  .breadcrumb-section {
    font-size: var(--text-sm);
    color: var(--text-muted);
    white-space: nowrap;
  }

  .breadcrumb-sep {
    font-size: var(--text-sm);
    color: var(--text-muted);
  }

  .breadcrumb-slug {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .unsaved-hint {
    font-size: var(--text-xs);
    color: var(--text-muted);
    white-space: nowrap;
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-shrink: 0;
  }

  /* --- Two-column body --- */

  .editor-body {
    display: grid;
    grid-template-columns: 1fr 360px;
    min-height: 480px;
  }

  /* --- LEFT: prompt editor --- */

  .prompt-editor {
    display: flex;
    flex-direction: column;
    border-right: 1px solid var(--border-muted);
  }

  .prompt-toolbar {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border-bottom: 1px solid var(--border-muted);
    background: var(--surface-raised);
    font-size: var(--text-xs);
    color: var(--text-muted);
  }

  .prompt-toolbar-title {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    font-weight: var(--font-medium);
    color: var(--text);
  }

  .prompt-toolbar-hint {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .prompt-line-count {
    flex-shrink: 0;
    font-family: var(--font-mono);
    white-space: nowrap;
  }

  .prompt-content {
    display: flex;
    flex: 1;
    overflow: hidden;
  }

  .line-gutter {
    padding: var(--space-3) var(--space-2) var(--space-3) var(--space-3);
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    line-height: 1.6;
    color: var(--text-muted);
    background: var(--surface-inset);
    border-right: 1px solid var(--border-muted);
    text-align: right;
    user-select: none;
    white-space: pre;
    min-width: 2.5rem;
    overflow: hidden;
  }

  .prompt-textarea {
    flex: 1;
    resize: none;
    border: none;
    padding: var(--space-3);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    line-height: 1.6;
    color: var(--text);
    background: var(--surface);
    tab-size: 2;
    white-space: pre;
    overflow: auto;
    box-sizing: border-box;
    /* Reset browser default outline; focus ring applied below */
    outline: none;
  }

  .prompt-textarea:focus-visible {
    box-shadow: inset 0 0 0 var(--ring-width) var(--ring-color);
  }

  .prompt-footer {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-2) var(--space-3);
    border-top: 1px solid var(--border-muted);
    background: var(--surface-raised);
    font-size: var(--text-xs);
    color: var(--text-muted);
  }

  .prompt-note {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }

  /* --- RIGHT: settings rail --- */

  .settings-rail {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-4);
    overflow-y: auto;
    background: var(--surface-raised);
  }

  .rail-section {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .rail-divider {
    border: none;
    border-top: 1px solid var(--border-muted);
    margin: 0;
  }

  /* Effort field: native select */

  .effort-field {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .effort-field label {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--text);
  }

  .effort-field select {
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface);
    color: var(--text);
    padding: var(--space-2) var(--space-3);
    font: inherit;
    font-size: var(--text-sm);
  }

  .effort-description {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--text-muted);
  }

  /* Enabled toggle row */

  .enabled-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-2) 0;
  }

  .enabled-copy {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
  }

  .enabled-label {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--text);
  }

  .enabled-description {
    font-size: var(--text-xs);
    color: var(--text-muted);
  }

  /* Dry run card */

  .dry-run-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
  }

  .dry-run-title {
    display: flex;
    align-items: center;
    gap: var(--space-1-5);
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--text);
  }

  .dry-run-body {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .dry-run-results {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: var(--space-2);
    padding: var(--space-3);
    border: 1px solid var(--border-muted);
    border-radius: var(--radius-md);
    background: var(--surface);
  }

  .dry-run-stat {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
  }

  .stat-label {
    font-size: var(--text-xs);
    color: var(--text-muted);
  }

  .stat-value {
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    color: var(--text);
  }

  .stat-value.mono {
    font-family: var(--font-mono);
  }

  /* ===== Agent list ===== */

  .agent-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    list-style: none;
    padding: 0;
    margin: 0;
  }

  .agent-row {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-4);
    margin-bottom: var(--space-3);
  }

  .agent-info {
    min-width: 0;
  }

  .agent-slug {
    margin: 0;
    font-size: var(--text-base);
    font-weight: var(--font-semibold);
    font-family: var(--font-mono);
    color: var(--text);
  }

  .agent-description {
    margin: var(--space-0-5) 0 0;
    font-size: var(--text-sm);
    color: var(--text-muted);
  }

  .agent-badges {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--space-2);
    flex-shrink: 0;
  }

  .row-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    margin-top: var(--space-3);
  }

  .agent-prompt {
    margin-top: var(--space-2);
    padding: var(--space-3);
    overflow: auto;
    border-radius: var(--radius-md);
    background: var(--surface-overlay);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text);
    white-space: pre-wrap;
  }

  .muted {
    color: var(--text-muted);
  }

  /* ===== Responsive ===== */

  @media (max-width: 768px) {
    .editor-body {
      grid-template-columns: 1fr;
    }

    .prompt-editor {
      border-right: none;
      border-bottom: 1px solid var(--border-muted);
    }

    .dry-run-results {
      grid-template-columns: 1fr;
    }

    .agent-row {
      flex-direction: column;
    }

    .agent-badges {
      justify-content: flex-start;
    }
  }

  @media (max-width: 480px) {
    .editor-header {
      flex-direction: column;
      align-items: flex-start;
    }

    .header-actions {
      align-self: flex-end;
    }
  }
</style>
