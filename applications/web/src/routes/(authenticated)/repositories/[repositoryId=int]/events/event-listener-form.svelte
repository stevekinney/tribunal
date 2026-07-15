<script lang="ts">
  import { enhance } from '$app/forms';
  import { Alert } from '@lostgradient/cinder/alert';
  import { Button } from '@lostgradient/cinder/button';
  import { Card } from '@lostgradient/cinder/card';
  import { Checkbox } from '@lostgradient/cinder/checkbox';
  import { Input } from '@lostgradient/cinder/input';
  import { MarkdownEditor } from '@lostgradient/cinder/markdown-editor';
  import { Select } from '@lostgradient/cinder/select';
  import Save from 'lucide-svelte/icons/save';
  import { untrack } from 'svelte';
  import type { RepositoryEventListener } from '@tribunal/database/schema';
  import type { EventListenerFilters } from '@tribunal/database/queries';

  type Props = {
    mode: 'new' | 'edit';
    listener: RepositoryEventListener | null;
    listenerFilters: EventListenerFilters;
    listenerFiltersInvalid?: boolean;
    agents: { id: string; slug: string; enabled: boolean }[];
    eventTypeOptions: string[];
    actionsByEventType: Record<string, string[]>;
    form?: { error?: string } | null;
    cancelHref: string;
  };

  let {
    mode,
    listener,
    listenerFilters,
    listenerFiltersInvalid = false,
    agents,
    eventTypeOptions,
    actionsByEventType,
    form = null,
    cancelHref,
  }: Props = $props();

  // Stored filters that failed to parse fail closed (the listener currently
  // matches nothing). Saving must not silently replace that state with
  // whatever the (blank) filter inputs show until the user explicitly
  // confirms they want to reset the filters -- see `+page.server.ts`'s
  // `editingListenerFiltersInvalid`/`acknowledgeFiltersReset` handling.
  let acknowledgeFiltersReset = $state(false);
  const filtersResetBlocked = $derived(listenerFiltersInvalid && !acknowledgeFiltersReset);

  let name = $state(untrack(() => listener?.name ?? ''));
  let eventType = $state(untrack(() => listener?.eventType ?? eventTypeOptions[0] ?? ''));
  let selectedAction = $state(untrack(() => listener?.action ?? ''));
  let agentId = $state(untrack(() => listener?.agentId ?? agents[0]?.id ?? ''));
  let instructionsMarkdown = $state(untrack(() => listener?.instructionsMarkdown ?? ''));
  let enabled = $state(untrack(() => listener?.enabled ?? true));
  let editorMode = $state<'source' | 'wysiwyg'>('source');
  let filterRef = $state(untrack(() => listenerFilters.ref ?? ''));
  let filterSenderLogin = $state(untrack(() => listenerFilters.senderLogin ?? ''));
  let filterPrNumber = $state(untrack(() => listenerFilters.prNumber?.toString() ?? ''));
  let filterIssueNumber = $state(untrack(() => listenerFilters.issueNumber?.toString() ?? ''));

  const eventTypeSelectOptions = $derived(
    eventTypeOptions.map((value) => ({ value, label: value })),
  );

  // Reset the selected action whenever the user changes the event type --
  // an action valid for the previous event type (e.g. "synchronize" for
  // pull_request) is meaningless once the event type changes (e.g. to
  // issues), and must not silently persist into the submitted listener.
  // Skipped on the very first run so an existing listener's stored
  // event type/action pairing is preserved when the form first mounts.
  let previousEventType = untrack(() => eventType);
  $effect(() => {
    if (eventType !== previousEventType) {
      selectedAction = '';
      previousEventType = eventType;
    }
  });

  // Editing an existing listener whose stored action is not among the
  // observed/selectable actions for its event type must still show that
  // action -- never silently discard it out from under the user.
  const actionSelectOptions = $derived.by(() => {
    const observed = actionsByEventType[eventType] ?? [];
    const options = selectedAction ? [...observed, selectedAction] : observed;
    const deduped = options.filter((value, index) => options.indexOf(value) === index);
    return [
      { value: '', label: 'Any action' },
      ...deduped.sort().map((value) => ({ value, label: value })),
    ];
  });

  const agentSelectOptions = $derived(
    agents.map((agent) => ({
      value: agent.id,
      label: agent.enabled ? agent.slug : `${agent.slug} (disabled)`,
    })),
  );

  const actionUrl = $derived(mode === 'new' ? '?/create' : '?/update');
  const submitLabel = $derived(mode === 'new' ? 'Create listener' : 'Save listener');
</script>

{#if form?.error}
  <Alert variant="danger">{form.error}</Alert>
{/if}

<Card title={mode === 'new' ? 'New event listener' : 'Edit event listener'} headingLevel={2}>
  <form method="POST" action={actionUrl} class="listener-form" use:enhance>
    {#if listener}
      <input type="hidden" name="listenerId" value={listener.id} />
    {/if}
    <input type="hidden" name="instructionsMarkdown" value={instructionsMarkdown} />

    <div class="field-grid">
      <Input
        id="listener-name"
        name="name"
        label="Name"
        bind:value={name}
        required
        placeholder="Triage new issues"
      />
      <Select
        id="listener-event-type"
        name="eventType"
        label="Event type"
        bind:value={eventType}
        options={eventTypeSelectOptions}
        description="Populated from subscribed GitHub App events and events already received for this repository."
      />
      <Select
        id="listener-action"
        name="action"
        label="Action"
        bind:value={selectedAction}
        options={actionSelectOptions}
      />
      <Select
        id="listener-agent"
        name="agentId"
        label="Agent"
        bind:value={agentId}
        options={agentSelectOptions}
      />
    </div>

    <fieldset class="filters-fieldset">
      <legend>Filters (optional)</legend>
      {#if listenerFiltersInvalid}
        <Alert variant="danger">
          This listener's stored filters could not be parsed, so it currently matches nothing (fails
          closed). Saving will replace them with whatever you set below -- confirm below to proceed.
        </Alert>
        <Checkbox
          id="acknowledge-filters-reset"
          label="I understand this replaces the invalid filters below."
          bind:checked={acknowledgeFiltersReset}
          fieldClass="acknowledge-filters-reset"
        />
        <input
          type="hidden"
          name="acknowledgeFiltersReset"
          value={acknowledgeFiltersReset ? 'true' : 'false'}
        />
      {/if}
      <div class="field-grid">
        <Input
          id="listener-filter-ref"
          name="filterRef"
          label="Ref"
          bind:value={filterRef}
          placeholder="refs/heads/main"
        />
        <Input
          id="listener-filter-sender"
          name="filterSenderLogin"
          label="Sender login"
          bind:value={filterSenderLogin}
          placeholder="octocat"
        />
        <Input
          id="listener-filter-pr-number"
          name="filterPrNumber"
          label="Pull request number"
          bind:value={filterPrNumber}
          inputmode="numeric"
        />
        <Input
          id="listener-filter-issue-number"
          name="filterIssueNumber"
          label="Issue number"
          bind:value={filterIssueNumber}
          inputmode="numeric"
        />
      </div>
    </fieldset>

    <div class="instructions-field">
      <MarkdownEditor
        id="listener-instructions"
        label="Instructions"
        bind:value={instructionsMarkdown}
        bind:mode={editorMode}
        showToolbar
        showModeToggle
        placeholder="Describe what the agent should do when this event matches..."
      />
    </div>

    <Checkbox id="listener-enabled" label="Enabled" name="enabled" bind:checked={enabled} />

    <div class="form-actions">
      <Button href={cancelHref} variant="secondary">Cancel</Button>
      <Button type="submit" variant="primary" disabled={filtersResetBlocked}>
        {#snippet leadingIcon()}<Save size={14} aria-hidden="true" />{/snippet}
        {submitLabel}
      </Button>
    </div>
  </form>
</Card>

<style>
  .listener-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .field-grid {
    display: grid;
    gap: var(--space-4);
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .filters-fieldset {
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    padding: var(--space-3);
  }

  .filters-fieldset legend {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    padding: 0 var(--space-1);
  }

  :global(.acknowledge-filters-reset) {
    margin: var(--space-3) 0;
  }

  .form-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
  }

  @media (max-width: 760px) {
    .field-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
