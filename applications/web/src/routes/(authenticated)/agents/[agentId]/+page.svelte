<script lang="ts">
  import Page from '$lib/components/page.svelte';
  import AgentEditor from '../agent-editor.svelte';
  import { Button } from '@lostgradient/cinder/button';
  import { Card } from '@lostgradient/cinder/card';
  import { ConfirmDialog } from '@lostgradient/cinder/confirm-dialog';
  import Trash2 from 'lucide-svelte/icons/trash-2';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();

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
  <AgentEditor
    agent={{
      id: data.agent.id,
      slug: data.agent.slug,
      description: data.agent.description,
      body: data.agent.body,
      model: data.agent.model,
      effort: data.agent.effort,
      enabled: data.agent.enabled,
    }}
    defaultModel={data.defaultModel}
    modelOptions={data.modelOptions}
    effortOptions={data.effortOptions}
    {form}
    submitLabel="Save changes"
  />

  <Card title="Danger zone" tone="danger" headingLevel={2}>
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
  </Card>
</Page>

<ConfirmDialog
  bind:open={confirmDeleteOpen}
  triggerRef={deleteTriggerRef}
  title={`Delete ${data.agent.slug}?`}
  description="This permanently deletes the agent. This action cannot be undone."
  destructive
  confirmLabel="Delete agent"
  onconfirm={() => deleteFormElement?.requestSubmit()}
/>

<style>
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
