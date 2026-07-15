<script lang="ts">
  import Page from '$lib/components/page.svelte';
  import { enhance } from '$app/forms';
  import { untrack } from 'svelte';
  import { Alert } from '@lostgradient/cinder/alert';
  import { Badge } from '@lostgradient/cinder/badge';
  import { Button } from '@lostgradient/cinder/button';
  import { Card } from '@lostgradient/cinder/card';
  import { Checkbox } from '@lostgradient/cinder/checkbox';
  import { FormField } from '@lostgradient/cinder/form-field';
  import { Link } from '@lostgradient/cinder/link';
  import { TagInput } from '@lostgradient/cinder/tag-input';
  import Save from 'lucide-svelte/icons/save';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();

  const repositoryName = $derived(`${data.repository.owner}/${data.repository.name}`);
  const breadcrumbs = $derived([
    { label: 'Repositories', href: '/repositories' },
    { label: repositoryName, href: `/repositories/${data.repository.id}/pull-requests` },
    { label: 'Settings' },
  ]);

  /**
   * First-time setup (not watched, no saved settings) defaults the agent
   * assignment to every enabled agent, mirroring the Add/toggle default on the
   * repositories dashboard (`agentIdsForWatch`). Otherwise it reflects the
   * repository's saved agent assignment. Without this, saving settings on a
   * never-configured repository would submit an empty `agentIds` list and
   * silently add the repository with no reviewers.
   */
  let selectedAgentIds = $state.raw(
    untrack(
      () =>
        new Set(
          !data.repository.review.watched && !data.repository.review.hasSavedSettings
            ? data.agents.filter((agent) => agent.enabled).map((agent) => agent.id)
            : data.repository.review.agents.map((agent) => agent.id),
        ),
    ),
  );
  let saving = $state(false);
</script>

<Page title="Repository settings" subtitle={repositoryName} {breadcrumbs}>
  {#if form?.error}
    <Alert variant="danger">{form.error}</Alert>
  {:else if form?.success}
    <Alert variant="success">Repository settings saved.</Alert>
  {/if}

  <form
    method="POST"
    class="settings-form"
    use:enhance={() => {
      saving = true;
      return async ({ result, update }) => {
        try {
          // Don't call update() on an error result: SvelteKit would navigate
          // to the nearest +error.svelte instead of keeping the settings form
          // in place with the error alert rendered from `form?.error`.
          if (result.type === 'error') return;
          // Never reset the form: TagInput's committed tags and each agent's
          // Checkbox checked state is local component state that must reflect
          // exactly what was just submitted, not the values captured at mount.
          await update({ reset: false });
        } finally {
          saving = false;
        }
      };
    }}
  >
    <Card
      title="Ignore globs"
      description="Matching files are skipped during review."
      headingLevel={2}
    >
      <FormField
        id="ignore-globs"
        label="Ignore globs"
        description="Press Enter or comma to add a glob."
      >
        <TagInput
          id="ignore-globs"
          name="ignoreGlobs"
          defaultValue={data.repository.review.ignoreGlobs}
          commitOnSubmit
          placeholder="dist/**"
          disabled={saving}
        />
      </FormField>
    </Card>

    <Card
      title="Review agents"
      description="Choose which agents review pull requests in this repository."
      headingLevel={2}
    >
      {#if data.agents.length === 0}
        <p class="field-description">Create an agent before assigning repository reviewers.</p>
      {:else}
        <ul class="agent-list">
          {#each data.agents as agent (agent.id)}
            {@const selected = selectedAgentIds.has(agent.id)}
            {@const canToggle = agent.enabled || selected}
            <li class="agent-row">
              <div class="agent-identity">
                <Link href={`/agents/${agent.id}`}>{agent.slug}</Link>
                {#if !agent.enabled}
                  <Badge size="sm" variant="neutral">Disabled</Badge>
                {/if}
              </div>
              {#if !agent.enabled}
                <p class="agent-helper">
                  {#if selected}
                    Disabled; turn off to remove it from this repository.
                  {:else}
                    Disabled agents cannot be assigned until re-enabled.
                  {/if}
                </p>
              {/if}
              <Checkbox
                id="repository-agent-{agent.id}"
                name="agentIds"
                value={agent.id}
                checked={selected}
                aria-label={selected ? `Remove ${agent.slug}` : `Add ${agent.slug}`}
                disabled={!canToggle || saving}
                onValueChange={(next) => {
                  const nextSelectedAgentIds = new Set(selectedAgentIds);
                  if (next) {
                    nextSelectedAgentIds.add(agent.id);
                  } else {
                    nextSelectedAgentIds.delete(agent.id);
                  }
                  selectedAgentIds = nextSelectedAgentIds;
                  return next;
                }}
              />
            </li>
          {/each}
        </ul>
      {/if}
    </Card>

    <div class="settings-actions">
      <Button type="submit" variant="primary" size="sm" disabled={saving}>
        {#snippet leadingIcon()}<Save size={14} aria-hidden="true" />{/snippet}
        {saving ? 'Saving…' : 'Save settings'}
      </Button>
    </div>
  </form>
</Page>

<style>
  .settings-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .field-description {
    color: var(--text-subtle);
    font-size: var(--text-sm);
    margin: 0;
  }

  .agent-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    list-style: none;
  }

  .agent-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    flex-wrap: wrap;
  }

  .agent-identity {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
  }

  .agent-helper {
    color: var(--text-subtle);
    font-size: var(--text-xs);
    margin: 0;
    flex: 1 1 100%;
  }

  .settings-actions {
    display: flex;
    justify-content: flex-end;
  }
</style>
