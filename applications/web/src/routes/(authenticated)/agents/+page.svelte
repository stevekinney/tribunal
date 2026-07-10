<script lang="ts">
  import Page from '$lib/components/page.svelte';
  import { Alert } from '@lostgradient/cinder/alert';
  import { Badge } from '@lostgradient/cinder/badge';
  import { Button } from '@lostgradient/cinder/button';
  import { Card } from '@lostgradient/cinder/card';
  import { EmptyState } from '@lostgradient/cinder/empty-state';
  import { Link } from '@lostgradient/cinder/link';
  import { StatusDot } from '@lostgradient/cinder/status-dot';
  import { Toggle } from '@lostgradient/cinder/toggle';
  import Plus from 'lucide-svelte/icons/plus';
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
                  <h2 class="agent-slug">
                    <Link href={`/agents/${agent.id}`} color="inherit">{agent.slug}</Link>
                  </h2>
                  <StatusDot
                    status={agent.enabled ? 'success' : 'offline'}
                    label={agent.enabled ? 'Enabled' : 'Disabled'}
                  />
                  <Badge size="sm">{agent.model}</Badge>
                  {#if agent.effort}<Badge size="sm">{agent.effort}</Badge>{/if}
                </div>
                {#if agent.description}
                  <p class="agent-description">{agent.description}</p>
                {/if}
              </div>
              <div class="agent-actions">
                <form id={`agent-${agent.id}-enabled-form`} method="POST" action="?/setEnabled">
                  <input type="hidden" name="id" value={agent.id} />
                  <input type="hidden" name="enabled" value={agent.enabled ? 'false' : 'true'} />
                  <Toggle
                    id={`agent-${agent.id}-enabled`}
                    label={`${agent.enabled ? 'Disable' : 'Enable'} ${agent.slug}`}
                    hideLabel
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
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
  }

  .agent-copy {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
  }

  .agent-heading {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
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
    .agent-row {
      align-items: stretch;
      flex-direction: column;
    }
  }
</style>
