<script lang="ts">
  import Page from '$lib/components/page.svelte';
  import AgentEditor from '../agent-editor.svelte';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();
</script>

<Page
  title="New agent"
  subtitle="Create a read-only review agent"
  breadcrumbs={[
    { label: 'Agents', href: '/agents' },
    { label: 'New agent', href: '/agents/new' },
  ]}
>
  <AgentEditor
    agent={{
      slug: '',
      description: '',
      body: '',
      model: 'inherit',
      effort: null,
      enabled: true,
    }}
    defaultModel={data.defaultModel}
    modelOptions={data.modelOptions}
    effortOptions={data.effortOptions}
    {form}
    submitLabel="Create agent"
  />
</Page>
