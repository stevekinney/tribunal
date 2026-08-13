<script lang="ts">
  import Page from '$lib/components/page.svelte';
  import { enhance } from '$app/forms';
  import { untrack } from 'svelte';
  import { Alert } from '@lostgradient/cinder/alert';
  import { Badge } from '@lostgradient/cinder/badge';
  import { Button } from '@lostgradient/cinder/button';
  import { Card } from '@lostgradient/cinder/card';
  import { Checkbox } from '@lostgradient/cinder/checkbox';
  import { ConfirmDialog } from '@lostgradient/cinder/confirm-dialog';
  import { EmptyState } from '@lostgradient/cinder/empty-state';
  import { FormField } from '@lostgradient/cinder/form-field';
  import { Link } from '@lostgradient/cinder/link';
  import { TagInput } from '@lostgradient/cinder/tag-input';
  import EyeOff from 'lucide-svelte/icons/eye-off';
  import Save from 'lucide-svelte/icons/save';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();

  const repositoryName = $derived(`${data.repository.owner}/${data.repository.name}`);
  const breadcrumbs = $derived([
    { label: 'Repositories', href: '/repositories' },
    { label: repositoryName, href: `/repositories/${data.repository.id}/pull-requests` },
    { label: 'Settings' },
  ]);

  let confirmUnwatchOpen = $state(false);
  let unwatchTriggerRef = $state<HTMLElement | null>(null);
  let unwatchFormElement = $state<HTMLFormElement | null>(null);
  /**
   * Set the instant unwatching is confirmed, not when the unwatch form's
   * submission resolves — it never does, in the observable sense. This is a
   * plain (non-enhanced) form, so confirming it starts a real cross-document
   * navigation to `/repositories` rather than an awaitable fetch; the old
   * page (and this state) stays around, interactive, until that navigation
   * completes. If GitHub or the network is slow, that can be a while. Gating
   * the settings form on `saving` alone only blocks a save that's already in
   * flight from racing a *new* unwatch click — it does nothing once unwatch
   * has already been confirmed and is silently in flight itself, which is
   * exactly when a "Save settings" click would race it: the save always
   * writes `watched: true` with the edited values, the unwatch write is
   * already in flight with `watched: false` and a snapshot of the old
   * values, and whichever request the server finishes last wins.
   */
  let unwatching = $state(false);

  function openUnwatchConfirmation(event: MouseEvent) {
    unwatchTriggerRef = event.currentTarget as HTMLElement;
    confirmUnwatchOpen = true;
  }

  function confirmUnwatch() {
    unwatching = true;
    unwatchFormElement?.requestSubmit();
  }

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
          value={data.repository.review.ignoreGlobs}
          commitOnSubmit
          placeholder="dist/**"
          disabled={saving || unwatching}
        />
      </FormField>
    </Card>

    <Card
      title="Review agents"
      description="Choose which agents review pull requests in this repository."
      headingLevel={2}
    >
      {#if data.agents.length === 0}
        <EmptyState
          title="No review agents"
          description="Create an agent before assigning repository reviewers."
        />
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
                aria-label={`Assign ${agent.slug} to repository`}
                disabled={!canToggle || saving || unwatching}
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
      <Button type="submit" variant="primary" size="sm" disabled={saving || unwatching}>
        {#snippet leadingIcon()}<Save size={14} aria-hidden="true" />{/snippet}
        {saving ? 'Saving…' : 'Save settings'}
      </Button>
    </div>
  </form>

  {#if data.repository.review.watched}
    <Card title="Danger zone" tone="danger" headingLevel={2}>
      <p class="danger-copy">
        Stop watching this repository. Tribunal removes it from the repositories list and stops
        starting new reviews on its pull requests. A review already running finishes and still posts
        its result. Saved ignore globs and agent assignments are kept, so re-adding it later
        restores this configuration.
      </p>
      <!--
        Posts to the repositories list's existing `?/watch` action (not a
        second named action on this route — see the note on this route's
        `default` action in +page.server.ts) with the repository's current
        agent assignment and ignore globs, exactly like the removed
        repositories-list row toggle used to, so unwatching preserves this
        configuration for a later re-add. `watched` is omitted (absent =
        off) since this form only ever turns watching off.
      -->
      <form
        method="POST"
        action="/repositories?/watch"
        bind:this={unwatchFormElement}
        class="unwatch-form"
      >
        <input type="hidden" name="repositoryId" value={data.repository.id} />
        <!--
          Deliberately submits no `agentIds` or `ignoreGlobs`. Hidden fields
          would carry this page's render-time snapshot, and `?/watch` treats
          submitted values as authoritative — so unwatching from a tab left
          open while another tab saved new settings would silently roll that
          newer configuration back. With both fields absent the action reads
          the repository's current saved settings instead (see its
          `!formData.has('ignoreGlobs') && submittedAgentIds.length === 0`
          branch), which preserves whatever is actually stored for a later
          re-add — the behavior these fields were added for, without the
          stale-snapshot hazard.
        -->
        <!--
          Disabled while the settings form's save is in flight, or once
          unwatching has itself been confirmed: that save always writes
          `watched: true` (see `submitRepositorySettingsForm`), while this
          form's hidden `agentIds`/`ignoreGlobs` snapshot the settings as of
          render, not whatever a save is about to persist. Submitting both at
          once would race — whichever request finishes last could
          unexpectedly re-watch the repository or overwrite the newly saved
          configuration with this form's stale values. The `unwatching` half
          of the guard is defensive (this button is normally already hidden
          behind the confirm dialog by the time it would matter) — the real
          fix for the reverse direction is disabling "Save settings" below.
        -->
        <Button
          type="button"
          variant="danger"
          disabled={saving || unwatching}
          onclick={openUnwatchConfirmation}
        >
          {#snippet leadingIcon()}<EyeOff size={14} aria-hidden="true" />{/snippet}
          Stop watching
        </Button>
      </form>
    </Card>
  {/if}
</Page>

<ConfirmDialog
  bind:open={confirmUnwatchOpen}
  triggerRef={unwatchTriggerRef}
  title="Stop watching this repository?"
  description="Tribunal removes it from the repositories list and stops starting new reviews. A review already running finishes and still posts its result. Saved ignore globs and agent assignments are kept for next time."
  destructive
  typeToConfirm={data.repository.name}
  typeToConfirmLabel="Type the repository name to confirm"
  confirmLabel="Stop watching"
  onConfirm={confirmUnwatch}
/>

<style>
  .settings-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
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

  .danger-copy {
    color: var(--text-muted);
    font-size: var(--text-sm);
    margin: 0 0 var(--space-4);
  }

  .unwatch-form {
    display: flex;
    justify-content: flex-start;
  }
</style>
