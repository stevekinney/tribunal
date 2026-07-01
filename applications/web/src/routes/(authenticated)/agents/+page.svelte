<script lang="ts">
  import Page from '$lib/components/page.svelte';
  import { Alert } from '@lostgradient/cinder/alert';
  import { Badge } from '@lostgradient/cinder/badge';
  import { Button } from '@lostgradient/cinder/button';
  import { Card } from '@lostgradient/cinder/card';
  import { EmptyState } from '@lostgradient/cinder/empty-state';
  import { StatusDot } from '@lostgradient/cinder/status-dot';
  import { Toggle } from '@lostgradient/cinder/toggle';
  import Pencil from 'lucide-svelte/icons/pencil';
  import Plus from 'lucide-svelte/icons/plus';
  import Trash2 from 'lucide-svelte/icons/trash-2';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();
</script>

<Page title="Agents" subtitle="Reusable read-only review agents">
  {#snippet actions()}
    <Button href="/agents/new" variant="primary">
      {#snippet leadingIcon()}<Plus size={14} aria-hidden="true" />{/snippet}
      New agent
    </Button>
  {/snippet}

  {#if form?.error}
    <Alert variant="danger">{form.error}</Alert>
  {/if}

  {#if data.agents.length === 0}
    <EmptyState
      title="No agents"
      description="Create a review agent to start checking watched repositories."
    >
      {#snippet action()}
        <Button href="/agents/new" variant="primary">
          {#snippet leadingIcon()}<Plus size={14} aria-hidden="true" />{/snippet}
          New agent
        </Button>
      {/snippet}
    </EmptyState>
  {:else}
    <ul class="agent-list">
      {#each data.agents as agent (agent.id)}
        <li>
          <Card>
            <div class="agent-row">
              <div class="agent-copy">
                <div class="agent-heading">
                  <h2 class="agent-slug">{agent.slug}</h2>
                  <Badge size="sm" variant={agent.enabled ? 'success' : 'neutral'}>
                    <StatusDot
                      status={agent.enabled ? 'success' : 'offline'}
                      label={agent.enabled ? 'Enabled' : 'Disabled'}
                    />
                    {agent.enabled ? 'Enabled' : 'Disabled'}
                  </Badge>
                </div>
                <p class="agent-description">{agent.description}</p>
                <div class="agent-meta">
                  <Badge size="sm">{agent.model}</Badge>
                  {#if agent.effort}<Badge size="sm">{agent.effort}</Badge>{/if}
                </div>
              </div>
              <div class="agent-actions">
                <form id={`agent-${agent.id}-enabled-form`} method="POST" action="?/setEnabled">
                  <input type="hidden" name="id" value={agent.id} />
                  <input type="hidden" name="enabled" value={agent.enabled ? 'false' : 'true'} />
                  <Toggle
                    id={`agent-${agent.id}-enabled`}
                    label={`${agent.enabled ? 'Disable' : 'Enable'} ${agent.slug}`}
                    checked={agent.enabled}
                    onValueChange={(next) => {
                      if (next === agent.enabled) return;
                      const form = document.getElementById(
                        `agent-${agent.id}-enabled-form`,
                      ) as HTMLFormElement | null;
                      form?.requestSubmit();
                    }}
                  />
                </form>
                <Button href={`/agents/${agent.id}`} variant="secondary">
                  {#snippet leadingIcon()}<Pencil size={14} aria-hidden="true" />{/snippet}
                  Edit
                </Button>
                <form method="POST" action="?/delete">
                  <input type="hidden" name="id" value={agent.id} />
                  <Button type="submit" variant="danger">
                    {#snippet leadingIcon()}<Trash2 size={14} aria-hidden="true" />{/snippet}
                    Delete
                  </Button>
                </form>
              </div>
            </div>
          </Card>
        </li>
      {/each}
    </ul>
  {/if}
</Page>

<style>
  .agent-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .agent-row {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-4);
  }

  .agent-copy {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
  }

  .agent-heading,
  .agent-meta,
  .agent-actions {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .agent-slug {
    font-size: var(--text-base);
    font-weight: var(--font-semibold);
    margin: 0;
  }

  .agent-description {
    color: var(--text-muted);
    font-size: var(--text-sm);
    margin: 0;
  }

  .agent-actions {
    flex-shrink: 0;
  }

  @media (max-width: 760px) {
    .agent-row,
    .agent-actions {
      align-items: stretch;
      flex-direction: column;
    }
  }
</style>
