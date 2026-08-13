<script lang="ts">
  import Page from '$lib/components/page.svelte';
  import AgentEditor, { AGENT_EDITOR_FORM_ID } from '../agent-editor.svelte';
  import { Button } from '@lostgradient/cinder/button';
  import { Checkbox } from '@lostgradient/cinder/checkbox';
  import { Collapsible } from '@lostgradient/cinder/collapsible';
  import { ConfirmDialog } from '@lostgradient/cinder/confirm-dialog';
  import Trash2 from 'lucide-svelte/icons/trash-2';
  import { untrack } from 'svelte';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();

  let enabled = $state(untrack(() => form?.values?.enabled ?? data.agent.enabled));

  let confirmDeleteOpen = $state(false);
  let deleteTriggerRef = $state<HTMLElement | null>(null);
  let deleteFormElement = $state<HTMLFormElement | null>(null);

  function openDeleteConfirmation(event: MouseEvent) {
    deleteTriggerRef = event.currentTarget as HTMLElement;
    confirmDeleteOpen = true;
  }
</script>

<Page
  title={data.agent.slug}
  subtitle={data.agent.description}
  breadcrumbs={[
    { label: 'Agents', href: '/agents' },
    { label: data.agent.slug, href: `/agents/${data.agent.id}` },
  ]}
>
  {#snippet actions()}
    <Checkbox
      id="agent-enabled"
      label="Enabled"
      name="enabled"
      form={AGENT_EDITOR_FORM_ID}
      bind:checked={enabled}
    />
  {/snippet}

  <AgentEditor
    agent={{
      id: data.agent.id,
      slug: data.agent.slug,
      description: data.agent.description,
      body: data.agent.body,
      model: data.agent.model,
      effort: data.agent.effort,
    }}
    defaultModel={data.defaultModel}
    modelOptions={data.modelOptions}
    effortOptions={data.effortOptions}
    {form}
    submitLabel="Save changes"
  />

  <Collapsible trigger="Danger zone" class="danger-zone">
    <p class="danger-copy">
      Permanently delete this agent. It stops running for repository automation immediately. This
      action cannot be undone.
    </p>
    <form method="POST" action="?/delete" bind:this={deleteFormElement} class="delete-form">
      <input type="hidden" name="id" value={data.agent.id} />
      <Button type="button" variant="danger" onclick={openDeleteConfirmation}>
        {#snippet leadingIcon()}<Trash2 size={14} aria-hidden="true" />{/snippet}
        Delete agent
      </Button>
    </form>
  </Collapsible>
</Page>

<ConfirmDialog
  bind:open={confirmDeleteOpen}
  triggerRef={deleteTriggerRef}
  title={`Delete ${data.agent.slug}?`}
  description="This permanently deletes the agent. This action cannot be undone."
  destructive
  confirmLabel="Delete agent"
  onConfirm={() => deleteFormElement?.requestSubmit()}
/>

<style>
  :global(.danger-zone) {
    border: 1px solid var(--danger-bg-strong);
    border-radius: var(--radius-lg);
    background: var(--danger-bg);
  }

  .danger-copy {
    color: var(--text-muted);
    font-size: var(--text-sm);
    margin: 0 0 var(--space-4);
  }

  .delete-form {
    display: flex;
    justify-content: flex-start;
  }
</style>
