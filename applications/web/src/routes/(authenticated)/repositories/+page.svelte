<script lang="ts">
  import type { PageProps } from './$types';
  import { SvelteMap, SvelteSet } from 'svelte/reactivity';
  import { enhance } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import Page from '$lib/components/page.svelte';
  import { Card } from '@lostgradient/cinder/card';
  import { Link } from '@lostgradient/cinder/link';
  import { Badge } from '@lostgradient/cinder/badge';
  import { Button } from '@lostgradient/cinder/button';
  import { SearchField } from '@lostgradient/cinder/search-field';
  import { Select } from '@lostgradient/cinder/select';
  import { EmptyState } from '@lostgradient/cinder/empty-state';
  import { Table } from '@lostgradient/cinder/table';
  import { Toggle } from '@lostgradient/cinder/toggle';
  import { StatusDot } from '@lostgradient/cinder/status-dot';
  import type { StatusDotStatus } from '@lostgradient/cinder/status-dot';
  import { Alert } from '@lostgradient/cinder/alert';
  import { FolderGit2, Plus } from 'lucide-svelte';
  import GithubIcon from 'lucide-svelte/icons/github';
  import WebhookIcon from 'lucide-svelte/icons/webhook';

  let { data, form }: PageProps = $props();

  let searchQuery = $state('');
  let repositoryToAdd = $state('');

  /**
   * Optimistic watch states keyed by repository ID. Populated on toggle click and
   * cleared after the form action's `update()` resolves, so the server state takes
   * over again. On failure, clearing the local state rolls the UI back to the
   * last server-confirmed value.
   */
  const localWatchStates = new SvelteMap<number, boolean>();
  const activeWatchSubmissions = new SvelteSet<number>();
  const queuedWatchStates = new SvelteMap<number, boolean>();

  const repositories = $derived(data.repositories);
  const availableRepositories = $derived(data.availableRepositories ?? []);
  const availableRepositoryOptions = $derived([
    { value: '', label: 'Select repository', disabled: true },
    ...availableRepositories.map((repository) => ({
      value: String(repository.id),
      label: `${repository.owner}/${repository.name}`,
    })),
  ]);
  const agents = $derived(data.agents ?? []);
  const hasInstallations = $derived(data.installations.length > 0);

  const subtitle = $derived(
    repositories.length > 0
      ? `${repositories.length} ${repositories.length === 1 ? 'repository' : 'repositories'} added`
      : 'Add repositories to start reviewing pull requests',
  );

  const filteredRepositories = $derived.by(() => {
    const base = repositories;
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
    if (hasInstallations) return 'No repositories added';
    return 'Install the GitHub App';
  });
  const emptyStateDescription = $derived.by(() => {
    if (data.needsConnect) return 'Connect GitHub before installing the GitHub App.';
    if (hasInstallations) return 'Choose a repository from the add control above.';
    return 'Install Tribunal on a repository, then add it here.';
  });
  const emptyStateActionLabel = $derived.by(() => {
    if (data.needsConnect) return 'Connect GitHub';
    if (hasInstallations) return 'Add repository';
    return 'Install Tribunal';
  });
  const emptyStateActionHref = $derived.by(() => {
    if (data.needsConnect) return '/connect/github/account';
    if (hasInstallations && availableRepositories.length > 0) return '#repository-to-add';
    return '/connect/github';
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

  function formDataForWatch(
    repository: (typeof data.repositories)[number],
    watched: boolean,
  ): FormData {
    const formData = new FormData();
    formData.set('repositoryId', String(repository.id));
    formData.set('watched', watched ? 'on' : '');
    for (const agentId of agentIdsForWatch(repository)) {
      formData.append('agentIds', agentId);
    }
    formData.set('ignoreGlobs', repository.review.ignoreGlobs.join('\n'));
    return formData;
  }

  function setWatchedFormValue(form: HTMLFormElement, watched: boolean): void {
    const watchedField = form.elements.namedItem('watched');
    if (watchedField instanceof HTMLInputElement) {
      watchedField.value = watched ? 'on' : '';
    }
  }

  function submitWatchForm(repositoryId: number, watched: boolean): boolean {
    const watchForm = document.getElementById(`watch-form-${repositoryId}`);
    if (!(watchForm instanceof HTMLFormElement)) return false;

    setWatchedFormValue(watchForm, watched);

    if (activeWatchSubmissions.has(repositoryId)) {
      queuedWatchStates.set(repositoryId, watched);
      return true;
    }

    activeWatchSubmissions.add(repositoryId);
    watchForm.requestSubmit();
    return true;
  }

  async function submitQueuedWatchState(
    repository: (typeof data.repositories)[number],
  ): Promise<boolean> {
    const repositoryId = repository.id;
    if (queuedWatchStates.has(repositoryId)) {
      const queuedWatched = queuedWatchStates.get(repositoryId) as boolean;
      queuedWatchStates.delete(repositoryId);
      if (!submitWatchForm(repositoryId, queuedWatched)) {
        try {
          const response = await fetch('?/watch', {
            method: 'POST',
            body: formDataForWatch(repository, queuedWatched),
          });
          if (response.ok) {
            await invalidateAll();
          }
        } finally {
          if (!activeWatchSubmissions.has(repositoryId)) {
            localWatchStates.delete(repositoryId);
          }
        }
      }
      return true;
    }

    return false;
  }
</script>

<Page title="Repositories" {subtitle}>
  {#snippet actions()}
    {#if availableRepositories.length > 0}
      <form method="POST" action="?/watch" class="add-repository-form" use:enhance>
        <Select
          id="repository-to-add"
          name="repositoryId"
          bind:value={repositoryToAdd}
          options={availableRepositoryOptions}
          label="Add repository"
          required
        />
        <input type="hidden" name="watched" value="on" />
        <Button type="submit" variant="primary" size="sm" disabled={repositoryToAdd === ''}>
          {#snippet leadingIcon()}<Plus size={14} aria-hidden="true" />{/snippet}
          Add
        </Button>
      </form>
    {/if}
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
          <Button href={emptyStateActionHref} variant="primary" size="sm">
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
    </div>

    {#if filteredRepositories.length === 0}
      <p class="empty-hint">
        {#if searchQuery.trim()}
          No repositories matching "{searchQuery}".
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
                <Table.HeaderCell>Last run</Table.HeaderCell>
                <Table.HeaderCell align="right">30-day est.</Table.HeaderCell>
                <Table.HeaderCell align="center">Added</Table.HeaderCell>
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
                      <Button
                        href={`/repositories/${repository.id}/webhooks`}
                        variant="ghost"
                        size="xs"
                      >
                        {#snippet leadingIcon()}<WebhookIcon
                            size={14}
                            aria-hidden="true"
                          />{/snippet}
                        <span class="cinder-sr-only">Webhook events</span>
                      </Button>
                    </div>
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
                            try {
                              await update();
                            } finally {
                              activeWatchSubmissions.delete(id);
                              if (
                                !(await submitQueuedWatchState(repository)) &&
                                !activeWatchSubmissions.has(id)
                              ) {
                                localWatchStates.delete(id);
                              }
                            }
                          };
                        }}
                      >
                        <input type="hidden" name="repositoryId" value={repository.id} />
                        {#each agentIdsForWatch(repository) as agentId (agentId)}
                          <input type="hidden" name="agentIds" value={agentId} />
                        {/each}
                        <input
                          type="hidden"
                          name="ignoreGlobs"
                          value={repository.review.ignoreGlobs.join('\n')}
                        />
                        <input type="hidden" name="watched" value={isWatching ? 'on' : ''} />
                        <Toggle
                          id="watching-{repository.id}"
                          checked={isWatching}
                          label={isWatching ? 'Remove repository' : 'Add repository'}
                          hideLabel
                          onValueChange={(next) => {
                            localWatchStates.set(repository.id, next);
                            submitWatchForm(repository.id, next);
                            return next;
                          }}
                        />
                      </form>
                    </div>
                  </Table.Cell>
                </Table.Row>
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

  .add-repository-form {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
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
</style>
