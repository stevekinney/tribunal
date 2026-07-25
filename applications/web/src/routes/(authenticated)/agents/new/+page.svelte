<script lang="ts">
  import Page from '$lib/components/page.svelte';
  import AgentEditor, { AGENT_EDITOR_FORM_ID } from '../agent-editor.svelte';
  import { Checkbox } from '@lostgradient/cinder/checkbox';
  import { untrack } from 'svelte';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();

  let enabled = $state(untrack(() => form?.values?.enabled ?? true));
</script>

<Page
  title="New agent"
  subtitle="Create a read-only review agent"
  breadcrumbs={[
    { label: 'Agents', href: '/agents' },
    { label: 'New agent', href: '/agents/new' },
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
      slug: '',
      description: '',
      body: '',
      model: 'inherit',
      effort: null,
    }}
    defaultModel={data.defaultModel}
    modelOptions={data.modelOptions}
    effortOptions={data.effortOptions}
    {form}
    submitLabel="Create agent"
  />
</Page>
