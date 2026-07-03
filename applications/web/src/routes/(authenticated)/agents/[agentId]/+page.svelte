<script lang="ts">
  import Page from '$lib/components/page.svelte';
  import AgentEditor from '../agent-editor.svelte';
  import { Badge } from '@lostgradient/cinder/badge';
  import { Card } from '@lostgradient/cinder/card';
  import { CodeBlock } from '@lostgradient/cinder/code-block';
  import { StatusDot } from '@lostgradient/cinder/status-dot';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();
</script>

<Page
  title={data.agent.slug}
  subtitle={data.agent.description}
  breadcrumbs={[
    { label: 'Agents', href: '/agents' },
    { label: data.agent.slug, href: `/agents/${data.agent.id}` },
  ]}
>
  <Card title="Prompt preview" headingLevel={2}>
    <div class="agent-status">
      <Badge size="sm" variant={data.agent.enabled ? 'success' : 'neutral'}>
        <StatusDot
          status={data.agent.enabled ? 'success' : 'offline'}
          label={data.agent.enabled ? 'Enabled' : 'Disabled'}
        />
        {data.agent.enabled ? 'Enabled' : 'Disabled'}
      </Badge>
      <Badge size="sm">{data.agent.model}</Badge>
      {#if data.agent.effort}<Badge size="sm">{data.agent.effort}</Badge>{/if}
    </div>
    <CodeBlock code={data.agent.body} language="markdown" copyable />
  </Card>

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
</Page>

<style>
  .agent-status {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-bottom: var(--space-3);
  }
</style>
