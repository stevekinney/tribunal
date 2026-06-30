<script lang="ts">
  import type { PageProps } from './$types';
  import { SvelteMap, SvelteSet } from 'svelte/reactivity';
  import { enhance } from '$app/forms';
  import Page from '$lib/components/page.svelte';
  import { Card } from '@lostgradient/cinder/card';
  import { Link } from '@lostgradient/cinder/link';
  import { Badge } from '@lostgradient/cinder/badge';
  import { Button } from '@lostgradient/cinder/button';
  import { SearchField } from '@lostgradient/cinder/search-field';
  import { EmptyState } from '@lostgradient/cinder/empty-state';
  import { Table } from '@lostgradient/cinder/table';
  import { Toggle } from '@lostgradient/cinder/toggle';
  import { StatusDot } from '@lostgradient/cinder/status-dot';
  import type { StatusDotStatus } from '@lostgradient/cinder/status-dot';
  import { SegmentedControl } from '@lostgradient/cinder/segmented-control';
  import { Segment } from '@lostgradient/cinder/segment';
  import { Alert } from '@lostgradient/cinder/alert';
  import { FolderGit2, Plus, Settings } from 'lucide-svelte';
  import GitBranch from 'lucide-svelte/icons/git-branch';
  import GithubIcon from 'lucide-svelte/icons/github';

  let { data, form }: PageProps = $props();

  let searchQuery = $state('');
  let expandedSettings = $state<number | null>(null);
  let viewFilter = $state<'all' | 'watched'>('all');

  /**
   * Optimistic watch states keyed by repository ID. Populated on toggle click and
   * cleared after the form action's `update()` resolves, so the server state takes
   * over again. Rolled back automatically when the action fails because `update()`
   * does not invalidate on failure, leaving the server value unchanged.
   */
  const localWatchStates = new SvelteMap<number, boolean>();
  const activeWatchSubmissions = new SvelteSet<number>();
  const queuedWatchStates = new SvelteMap<number, boolean>();

  const repositories = $derived(data.repositories);
  const agents = $derived(data.agents ?? []);
  const hasInstallations = $derived(data.installations.length > 0);
  const watchedRepositories = $derived(repositories.filter((r) => r.review.watched));

  const subtitle = $derived(
    repositories.length > 0
      ? `${watchedRepositories.length} watched · ${repositories.length} accessible via GitHub App`
      : 'Repositories from your GitHub App installations',
  );

  const filteredRepositories = $derived.by(() => {
    const base = viewFilter === 'watched' ? watchedRepositories : repositories;
    if (!searchQuery.trim()) return base;
    const query = searchQuery.toLowerCase();
    return base.filter(
      (r) =>
        r.name.toLowerCase().includes(query) ||
        r.owner.toLowerCase().includes(query) ||
        `${r.owner}/${r.name}`.toLowerCase().includes(query),
    );
  });

  const emptyStateTitle = $derived.by(() => {
    if (data.needsConnect) return 'Connect GitHub to get started';
    if (hasInstallations) return 'No repositories selected';
    return 'Install the GitHub App';
  });
  const emptyStateDescription = $derived.by(() => {
    if (data.needsConnect) return 'Connect GitHub before installing the GitHub App.';
    if (hasInstallations) return 'Manage repository access in GitHub, then return to Tribunal.';
    return 'Install the GitHub App on a repository, then it will show up here.';
  });
  const emptyStateActionLabel = $derived.by(() => {
    if (data.needsConnect) return 'Connect GitHub';
    if (hasInstallations) return 'Manage repository access';
    return 'Install GitHub App';
  });

  /** Maps a run status string to the nearest StatusDot semantic status. */
  function statusDotForRun(status: string): StatusDotStatus {
    const map: Record<string, StatusDotStatus> = {
      completed: 'success',
      failed: 'danger',
      running: 'accent',
      pending: 'pending',
      skipped: 'neutral',
    };
    return map[status] ?? 'neutral';
  }

  /** Sentence-case display label for a run status. */
  function statusLabel(status: string): string {
    const map: Record<string, string> = {
      completed: 'Completed',
      failed: 'Failed',
      running: 'Running',
      pending: 'Pending',
      skipped: 'Skipped',
    };
    return map[status] ?? status;
  }

  /**
   * Returns the agent IDs to submit when toggling watch state.
   *
   * - Already watched → preserve the current agent assignment.
   * - Not watched with saved settings → use the saved agent assignment.
   * - Not watched with no saved settings → default to all enabled agents.
   */
  function agentIdsForWatch(repository: (typeof data.repositories)[number]): string[] {
    if (!repository.review.watched && !repository.review.hasSavedSettings) {
      return agents.filter((a) => a.enabled).map((a) => a.id);
    }
    return repository.review.agents.map((a) => a.id);
  }

  /**
   * Resolves the effective watch state: returns the optimistic local state if
   * a toggle is pending, otherwise falls back to the confirmed server state.
   */
  function watchedFor(id: number, serverValue: boolean): boolean {
    return localWatchStates.has(id) ? (localWatchStates.get(id) as boolean) : serverValue;
  }

  function setWatchedFormValue(form: HTMLFormElement, watched: boolean): void {
    const watchedField = form.elements.namedItem('watched');
    if (watchedField instanceof HTMLInputElement) {
      watchedField.value = watched ? 'on' : '';
    }
  }

  function submitWatchForm(repositoryId: number, watched: boolean): void {
    const watchForm = document.getElementById(`watch-form-${repositoryId}`);
    if (!(watchForm instanceof HTMLFormElement)) return;

    setWatchedFormValue(watchForm, watched);

    if (activeWatchSubmissions.has(repositoryId)) {
      queuedWatchStates.set(repositoryId, watched);
      return;
    }

    activeWatchSubmissions.add(repositoryId);
    watchForm.requestSubmit();
  }

  function completeWatchSubmission(repositoryId: number): void {
    activeWatchSubmissions.delete(repositoryId);

    if (queuedWatchStates.has(repositoryId)) {
      const queuedWatched = queuedWatchStates.get(repositoryId) as boolean;
      queuedWatchStates.delete(repositoryId);
      submitWatchForm(repositoryId, queuedWatched);
      return;
    }

    localWatchStates.delete(repositoryId);
  }
</script>

<Page title="Repositories" {subtitle}>
  {#snippet actions()}
    <Button href="/connect/github" variant="secondary" size="sm">
      {#snippet leadingIcon()}<GitBranch size={14} aria-hidden="true" />{/snippet}
      Manage access
    </Button>
    <Button
      variant="primary"
      size="sm"
      onclick={() => {
        viewFilter = 'all';
        document.getElementById('repository-search')?.focus();
      }}
    >
      {#snippet leadingIcon()}<Plus size={14} aria-hidden="true" />{/snippet}
      Add repository
    </Button>
  {/snippet}

  {#if data.loadError}
    <Alert variant="danger">{data.loadError}</Alert>
  {/if}

  {#if form?.error}
    <Alert variant="danger">{form.error}</Alert>
  {/if}

  {#if repositories.length === 0}
    <Card padding="none">
      <EmptyState title={emptyStateTitle} description={emptyStateDescription}>
        {#snippet icon()}<FolderGit2 size={48} />{/snippet}
        {#snippet action()}
          <Button href="/connect/github" variant="primary" size="sm">
            {emptyStateActionLabel}
            {#snippet leadingIcon()}<GithubIcon size={14} aria-hidden="true" />{/snippet}
          </Button>
        {/snippet}
      </EmptyState>
    </Card>
  {:else}
    <div class="toolbar">
      <div class="search-wrapper">
        <SearchField
          id="repository-search"
          value={searchQuery}
          placeholder="Search repositories…"
          oninput={(value) => (searchQuery = value)}
        />
      </div>
      <SegmentedControl
        id="repo-filter"
        selectionMode="single"
        bind:value={viewFilter}
        label="Filter repositories"
        density="toolbar"
      >
        <Segment value="all">All</Segment>
        <Segment value="watched">Watched</Segment>
      </SegmentedControl>
    </div>

    {#if filteredRepositories.length === 0}
      <p class="empty-hint">
        {#if searchQuery.trim()}
          No repositories matching "{searchQuery}".
        {:else if viewFilter === 'watched'}
          No repositories are being watched yet. Switch to "All" to find and watch repositories.
        {:else}
          No repositories found.
        {/if}
      </p>
    {:else}
      <Card padding="none">
        <div class="table-scroll">
          <Table density="comfortable">
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>Repository</Table.HeaderCell>
                <Table.HeaderCell>Agents</Table.HeaderCell>
                <Table.HeaderCell>Last run</Table.HeaderCell>
                <Table.HeaderCell align="right">30-day est.</Table.HeaderCell>
                <Table.HeaderCell align="center">Watching</Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {#each filteredRepositories as repository (repository.id)}
                {@const isWatching = watchedFor(repository.id, repository.review.watched)}
                <Table.Row>
                  <Table.Cell>
                    <div class="repository-identity">
                      {#if repository.review.watched}
                        <Link href={`/repositories/${repository.id}/pull-requests`}>
                          <span class="repository-owner">{repository.owner}</span><span
                            class="repository-separator">/</span
                          ><span class="repository-name">{repository.name}</span>
                        </Link>
                      {:else}
                        <span class="repository-owner">{repository.owner}</span><span
                          class="repository-separator">/</span
                        ><span class="repository-name">{repository.name}</span>
                      {/if}
                      {#if repository.defaultBranch}
                        <Badge size="sm" variant="neutral">{repository.defaultBranch}</Badge>
                      {/if}
                    </div>
                  </Table.Cell>
                  <Table.Cell>
                    {#if repository.review.agents.length > 0}
                      <div class="agent-badges">
                        {#each repository.review.agents as agent (agent.id)}
                          <Badge size="sm" variant="accent">{agent.slug}</Badge>
                        {/each}
                      </div>
                    {:else}
                      <span class="text-muted">—</span>
                    {/if}
                  </Table.Cell>
                  <Table.Cell>
                    {#if repository.review.lastRunStatus}
                      <StatusDot
                        status={statusDotForRun(repository.review.lastRunStatus)}
                        label={statusLabel(repository.review.lastRunStatus)}
                        showLabel
                        size="sm"
                      />
                    {:else}
                      <span class="text-muted">Never</span>
                    {/if}
                  </Table.Cell>
                  <Table.Cell align="right">
                    <span class="cost"
                      >${repository.review.estimatedCostLast30DaysUsd.toFixed(2)}</span
                    >
                  </Table.Cell>
                  <Table.Cell align="center">
                    <div class="watching-cell">
                      <form
                        id="watch-form-{repository.id}"
                        method="POST"
                        action="?/watch"
                        class="watch-form"
                        use:enhance={({ formData }) => {
                          const id = repository.id;
                          const watched = watchedFor(id, repository.review.watched);
                          formData.set('watched', watched ? 'on' : '');

                          return async ({ update }) => {
                            if (expandedSettings === id) expandedSettings = null;
                            try {
                              await update();
                            } finally {
                              completeWatchSubmission(id);
                            }
                          };
                        }}
                      >
                        <input type="hidden" name="repositoryId" value={repository.id} />
                        <!--
                          These labeled controls are visually hidden (sr-only) so they are present
                          in the DOM and queryable by label without requiring the gear panel to open.
                          They replace the old hidden inputs, preserving saved settings on toggle.
                        -->
                        {#if agents.length > 0}
                          {@const selectedAgentIds = agentIdsForWatch(repository)}
                          <label class="settings-visually-hidden">
                            <span>Agents</span>
                            <!-- Visually hidden, but kept in the DOM to preserve
                                 saved settings on toggle. tabindex=-1 removes the
                                 invisible control from the keyboard tab order. -->
                            <select name="agentIds" multiple tabindex="-1">
                              {#each agents as agent (agent.id)}
                                <option
                                  value={agent.id}
                                  selected={selectedAgentIds.includes(agent.id)}
                                >
                                  {agent.slug}
                                </option>
                              {/each}
                            </select>
                          </label>
                        {/if}
                        <label class="settings-visually-hidden">
                          <span>Ignore globs</span>
                          <textarea
                            name="ignoreGlobs"
                            tabindex="-1"
                            value={repository.review.ignoreGlobs.join('\n')}
                          ></textarea>
                        </label>
                        <!-- Submit the current optimistic watch state. -->
                        <input type="hidden" name="watched" value={isWatching ? 'on' : ''} />
                        <Toggle
                          id="watching-{repository.id}"
                          checked={isWatching}
                          label={isWatching ? 'Unwatch repository' : 'Watch repository'}
                          hideLabel
                          onValueChange={(next) => {
                            localWatchStates.set(repository.id, next);
                            submitWatchForm(repository.id, next);
                            return next;
                          }}
                        />
                      </form>
                      <Button
                        iconOnly
                        label={`Settings for ${repository.owner}/${repository.name}`}
                        variant="ghost"
                        size="sm"
                        aria-expanded={expandedSettings === repository.id}
                        aria-controls="settings-{repository.id}"
                        onclick={() =>
                          (expandedSettings =
                            expandedSettings === repository.id ? null : repository.id)}
                      >
                        {#snippet leadingIcon()}<Settings size={14} aria-hidden="true" />{/snippet}
                      </Button>
                    </div>
                  </Table.Cell>
                </Table.Row>
                {#if expandedSettings === repository.id}
                  <Table.Row id="settings-{repository.id}">
                    <Table.Cell colspan={5}>
                      <form method="POST" action="?/watch" class="settings-form" use:enhance>
                        <input type="hidden" name="repositoryId" value={repository.id} />
                        <input type="hidden" name="watched" value="on" />
                        {#if agents.length > 0}
                          <label class="settings-field">
                            <span class="settings-label">Assigned agents</span>
                            <select
                              name="agentIds"
                              multiple
                              size={Math.min(Math.max(agents.length, 2), 5)}
                              class="settings-select"
                            >
                              {#each agents as agent (agent.id)}
                                <option
                                  value={agent.id}
                                  selected={repository.review.agents.some(
                                    (assigned) => assigned.id === agent.id,
                                  )}
                                >
                                  {agent.slug}{agent.enabled ? '' : ' (disabled)'}
                                </option>
                              {/each}
                            </select>
                          </label>
                        {/if}
                        <label class="settings-field">
                          <span class="settings-label">Ignore globs</span>
                          <textarea
                            name="ignoreGlobs"
                            rows="3"
                            spellcheck="false"
                            class="settings-textarea"
                            value={repository.review.ignoreGlobs.join('\n')}
                          ></textarea>
                          <span class="settings-hint">One glob pattern per line.</span>
                        </label>
                        <div class="settings-actions">
                          <Button type="submit" variant="secondary" size="sm">Save settings</Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onclick={() => (expandedSettings = null)}
                          >
                            Cancel
                          </Button>
                        </div>
                      </form>
                    </Table.Cell>
                  </Table.Row>
                {/if}
              {/each}
            </Table.Body>
          </Table>
        </div>
      </Card>
      <p class="table-hint">
        Showing {filteredRepositories.length} of {repositories.length}
        {repositories.length === 1 ? 'repository' : 'repositories'}.
      </p>
    {/if}
  {/if}
</Page>

<style>
  .toolbar {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    flex-wrap: wrap;
  }

  .search-wrapper {
    flex: 1;
    min-width: 240px;
  }

  .empty-hint {
    font-size: var(--text-sm);
    color: var(--text-muted);
  }

  .table-scroll {
    overflow-x: auto;
  }

  .repository-identity {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-wrap: wrap;
    min-width: 0;
  }

  .repository-owner {
    color: var(--text-muted);
  }

  .repository-separator {
    color: var(--text-subtle);
  }

  .repository-name {
    font-weight: var(--font-medium);
    color: var(--text);
  }

  .agent-badges {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    flex-wrap: wrap;
  }

  .cost {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--text);
  }

  .text-muted {
    font-size: var(--text-sm);
    color: var(--text-muted);
  }

  .watching-cell {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-1);
  }

  .watch-form {
    display: flex;
    align-items: center;
  }

  .table-hint {
    font-size: var(--text-xs);
    color: var(--text-subtle);
  }

  .settings-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-4);
    background: var(--surface-overlay);
    border-radius: var(--radius-md);
    margin: var(--space-2) 0;
  }

  .settings-field {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .settings-label {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--text-muted);
  }

  .settings-hint {
    font-size: var(--text-xs);
    color: var(--text-muted);
  }

  .settings-select,
  .settings-textarea {
    width: 100%;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    padding: var(--space-2) var(--space-3);
    font-size: var(--text-sm);
    background: var(--surface);
    color: var(--text);
  }

  .settings-textarea {
    resize: vertical;
    font-family: var(--font-mono);
  }

  .settings-actions {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  /* Visually hides an element while keeping it in the DOM and accessibility tree.
     Controls labeled this way are queryable by assistive technology and by tests
     without requiring the gear settings panel to be expanded. */
  .settings-visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
    border-width: 0;
  }
</style>
