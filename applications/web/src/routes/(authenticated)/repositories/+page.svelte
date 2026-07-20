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
  import { Combobox } from '@lostgradient/cinder/combobox';
  import { EmptyState } from '@lostgradient/cinder/empty-state';
  import { Table } from '@lostgradient/cinder/table';
  import { Toggle } from '@lostgradient/cinder/toggle';
  import { StatusDot } from '@lostgradient/cinder/status-dot';
  import type { StatusDotStatus } from '@lostgradient/cinder/status-dot';
  import { StatGroup } from '@lostgradient/cinder/stat-group';
  import { DataList } from '@lostgradient/cinder/data-list';
  import { StackedListItem } from '@lostgradient/cinder/stacked-list-item';
  import { Alert } from '@lostgradient/cinder/alert';
  import { FolderGit2, Plus } from 'lucide-svelte';
  import GithubIcon from 'lucide-svelte/icons/github';
  import WebhookIcon from 'lucide-svelte/icons/webhook';

  let { data, form }: PageProps = $props();

  let searchQuery = $state('');
  let repositoryToAddId = $state('');
  let repositoryToAddInput = $state('');

  /**
   * Optimistic watch states keyed by repository ID. Populated on toggle click and
   * cleared after the form action's `update()` resolves, so the server state takes
   * over again. On failure, clearing the local state rolls the UI back to the
   * last server-confirmed value.
   */
  const localWatchStates = new SvelteMap<number, boolean>();
  const activeWatchSubmissions = new SvelteSet<number>();
  const queuedWatchStates = new SvelteMap<number, boolean>();

  // Only repositories explicitly added to Tribunal (watched) appear in the
  // table. The full accessible catalog is never rendered here — it lives behind
  // the "Add repository" picker as `data.addableRepositories`.
  const repositories = $derived(data.repositories);
  const summary = $derived(data.summary);
  const attentionPullRequests = $derived(data.attentionPullRequests ?? []);
  const hasInstallations = $derived(data.installations.length > 0);
  // The Add picker only renders when there is something to add, so empty-state
  // copy must not point at it unless an addable repository actually exists.
  const hasAddableRepositories = $derived(data.addableRepositories.length > 0);

  /**
   * Resolves the effective watch state: returns the optimistic local state if
   * a toggle is pending, otherwise falls back to the confirmed server state.
   */
  function watchedFor(id: number, serverValue: boolean): boolean {
    return localWatchStates.has(id) ? (localWatchStates.get(id) as boolean) : serverValue;
  }

  const addableRepositoryOptions = $derived(
    data.addableRepositories.map((repository) => ({
      value: String(repository.id),
      label: `${repository.owner}/${repository.name}`,
      description: repository.defaultBranch
        ? `Default branch: ${repository.defaultBranch}`
        : undefined,
    })),
  );

  const subtitle = $derived(
    repositories.length > 0
      ? `${repositories.length} ${repositories.length === 1 ? 'repository' : 'repositories'}`
      : 'Add a repository to start reviewing pull requests',
  );

  const filteredRepositories = $derived.by(() => {
    if (!searchQuery.trim()) return repositories;
    const query = searchQuery.toLowerCase();
    return repositories.filter(
      (r) =>
        r.name.toLowerCase().includes(query) ||
        r.owner.toLowerCase().includes(query) ||
        `${r.owner}/${r.name}`.toLowerCase().includes(query),
    );
  });

  const emptyStateTitle = $derived.by(() => {
    if (data.needsConnect) return 'Connect GitHub to get started';
    if (hasInstallations) return 'No repositories added yet';
    return 'Install the GitHub App';
  });
  const emptyStateDescription = $derived.by(() => {
    if (data.needsConnect) return 'Connect GitHub before installing the GitHub App.';
    if (hasInstallations)
      return hasAddableRepositories
        ? 'Use “Add repository” above to start reviewing pull requests. Only repositories you add are reviewed.'
        : 'Grant Tribunal access to a repository from “Manage repository access”, then add it here.';
    return 'Install Tribunal on a repository, then add it here.';
  });
  const emptyStateActionLabel = $derived.by(() => {
    if (data.needsConnect) return 'Connect GitHub';
    if (hasInstallations) return 'Manage repository access';
    return 'Install Tribunal';
  });
  const emptyStateActionHref = $derived.by(() => {
    if (data.needsConnect) return '/connect/github/account';
    return '/connect/github';
  });

  /** Maps a default-branch/pull-request CI status to the nearest StatusDot semantic status. */
  function ciStatusDotStatus(status: string): StatusDotStatus {
    const map: Record<string, StatusDotStatus> = {
      passing: 'success',
      failing: 'danger',
      pending: 'pending',
      error: 'danger',
      unknown: 'neutral',
    };
    return map[status] ?? 'neutral';
  }

  /** Sentence-case display label for a CI status, per the locked status vocabulary. */
  function ciStatusLabel(status: string): string {
    const map: Record<string, string> = {
      passing: 'Passing',
      failing: 'Failing',
      pending: 'Pending',
      error: 'Error',
      unknown: 'Unknown',
    };
    return map[status] ?? 'Unknown';
  }

  /** Sentence-case display label for a merge status. */
  function mergeStatusLabel(status: string): string {
    const map: Record<string, string> = {
      clean: 'Mergeable',
      conflicts: 'Conflicts',
      behind: 'Behind',
      blocked: 'Blocked',
      unknown: 'Unknown',
    };
    return map[status] ?? 'Unknown';
  }

  function mergeStatusVariant(status: string): 'success' | 'danger' | 'warning' | 'neutral' {
    if (status === 'clean') return 'success';
    if (status === 'conflicts') return 'danger';
    if (status === 'blocked') return 'warning';
    return 'neutral';
  }

  function ciBadgeVariant(status: string): 'success' | 'danger' | 'warning' | 'neutral' {
    if (status === 'passing') return 'success';
    if (status === 'failing' || status === 'error') return 'danger';
    if (status === 'pending') return 'warning';
    return 'neutral';
  }

  /**
   * Returns the agent IDs to submit when toggling a table row's watch state.
   * The table only ever contains added (watched) repositories, so this always
   * preserves the repository's current agent assignment — removing a repository
   * keeps its saved settings intact for a later re-add. First-time defaults for
   * repositories added through the picker are resolved server-side.
   */
  function agentIdsForWatch(repository: (typeof data.repositories)[number]): string[] {
    return repository.review.agents.map((a) => a.id);
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
    {#if addableRepositoryOptions.length > 0}
      <form
        method="POST"
        action="?/watch"
        class="add-repository-form"
        use:enhance={() => {
          return async ({ update, result }) => {
            if (result.type === 'error') {
              return;
            }
            await update();
            if (result.type === 'success') {
              repositoryToAddId = '';
              repositoryToAddInput = '';
            }
          };
        }}
      >
        <Combobox
          id="repository-to-add"
          name="repositoryId"
          label="Add repository"
          placeholder="Search by owner or name…"
          options={addableRepositoryOptions}
          bind:value={repositoryToAddId}
          bind:inputValue={repositoryToAddInput}
        />
        <input type="hidden" name="watched" value="on" />
        <Button type="submit" variant="primary" size="sm" disabled={repositoryToAddId === ''}>
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

  {#if repositories.some((repository) => repository.dashboard?.dataStatus === 'unavailable')}
    <Alert variant="warning">
      GitHub data for some repositories could not be refreshed this build. Their status shows as
      Unknown until the next refresh.
    </Alert>
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
    {#if summary}
      <StatGroup label="Dashboard summary">
        <StatGroup.Stat label="Repositories" value={summary.totalRepositoryCount} />
        <StatGroup.Stat
          label="Failing default branch"
          value={summary.failingDefaultBranchCountExact
            ? summary.failingDefaultBranchCount
            : `${summary.failingDefaultBranchCount}+`}
        />
        <StatGroup.Stat
          label="Open pull requests"
          value={summary.openPullRequestCountExact
            ? summary.openPullRequestCount
            : `${summary.openPullRequestCount}+`}
        />
        <StatGroup.Stat
          label="Needs attention"
          value={summary.attentionPullRequestCountExact
            ? summary.attentionPullRequestCount
            : `${summary.attentionPullRequestCount}+`}
        />
      </StatGroup>
    {/if}

    <ul class="attention-list-wrapper">
      <li>
        <h2 class="section-heading">Needs attention</h2>
        <DataList items={attentionPullRequests} key={(pr) => `${pr.repositoryId}:${pr.number}`}>
          {#snippet empty()}
            <p>
              {#if summary && !summary.attentionPullRequestCountExact}
                Attention data is incomplete: some repositories could not be checked this build, so
                this list may be missing pull requests.
              {:else}
                No open pull requests need attention right now.
              {/if}
            </p>
          {/snippet}
          {#snippet children(pullRequest)}
            <StackedListItem href={pullRequest.htmlUrl} target="_blank">
              {#snippet title()}#{pullRequest.number} {pullRequest.title}{/snippet}
              {#snippet description()}{pullRequest.repositoryOwner}/{pullRequest.repositoryName}{/snippet}
              {#snippet meta()}
                <div class="attention-badges">
                  <Badge size="sm" variant={pullRequest.draft ? 'neutral' : 'success'}>
                    {pullRequest.draft ? 'Draft' : 'Open'}
                  </Badge>
                  <Badge size="sm" variant={ciBadgeVariant(pullRequest.ciStatus)}>
                    {ciStatusLabel(pullRequest.ciStatus)}
                  </Badge>
                  <Badge size="sm" variant={mergeStatusVariant(pullRequest.mergeStatus)}>
                    {mergeStatusLabel(pullRequest.mergeStatus)}
                  </Badge>
                  <Badge
                    size="sm"
                    variant={(pullRequest.unresolvedThreadCount ?? 0) > 0 ? 'warning' : 'neutral'}
                  >
                    {pullRequest.unresolvedThreadCount === null
                      ? 'Unresolved threads unknown'
                      : `${pullRequest.unresolvedThreadCount} unresolved`}
                  </Badge>
                </div>
              {/snippet}
            </StackedListItem>
          {/snippet}
        </DataList>
      </li>
    </ul>

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
      <p class="empty-hint">No repositories matching "{searchQuery}".</p>
    {:else}
      <Card padding="none">
        <Table
          scrollable
          scrollContainerProps={{ 'aria-label': 'Repositories' }}
          density="comfortable"
        >
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>Repository</Table.HeaderCell>
              <Table.HeaderCell>Default branch CI</Table.HeaderCell>
              <Table.HeaderCell align="right">Open PRs</Table.HeaderCell>
              <Table.HeaderCell align="right">Attention</Table.HeaderCell>
              <Table.HeaderCell align="right">Unresolved threads</Table.HeaderCell>
              <Table.HeaderCell align="center">Watching</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {#each filteredRepositories as repository (repository.id)}
              {@const isWatching = watchedFor(repository.id, repository.review.watched)}
              {@const dashboard = repository.dashboard}
              <Table.Row>
                <Table.Cell>
                  <div class="repository-identity">
                    <Link href={`/repositories/${repository.id}/pull-requests`}>
                      <span class="repository-owner">{repository.owner}</span><span
                        class="repository-separator">/</span
                      ><span class="repository-name">{repository.name}</span>
                    </Link>
                    {#if repository.defaultBranch}
                      <Badge size="sm" variant="neutral">{repository.defaultBranch}</Badge>
                    {/if}
                    <Button
                      href={`/repositories/${repository.id}/webhooks`}
                      variant="ghost"
                      size="xs"
                    >
                      {#snippet leadingIcon()}<WebhookIcon size={14} aria-hidden="true" />{/snippet}
                      <span class="cinder-sr-only">Webhook events</span>
                    </Button>
                  </div>
                </Table.Cell>
                <Table.Cell>
                  <StatusDot
                    status={ciStatusDotStatus(dashboard?.defaultBranchStatus ?? 'unknown')}
                    label={ciStatusLabel(dashboard?.defaultBranchStatus ?? 'unknown')}
                    showLabel
                    size="sm"
                  />
                </Table.Cell>
                <Table.Cell align="right">
                  {#if dashboard && dashboard.openPullRequestCount !== null}
                    <Link href={`/repositories/${repository.id}/pull-requests`}>
                      {dashboard.openPullRequestCountAtCap
                        ? `${dashboard.openPullRequestCount}+`
                        : dashboard.openPullRequestCount}
                    </Link>
                  {:else}
                    <span class="text-muted">Unknown</span>
                  {/if}
                </Table.Cell>
                <Table.Cell align="right">
                  {#if dashboard && dashboard.attentionPullRequestCount !== null}
                    <Badge
                      size="sm"
                      variant={dashboard.attentionPullRequestCount > 0 ||
                      dashboard.openPullRequestCountAtCap
                        ? 'warning'
                        : 'success'}
                    >
                      {dashboard.openPullRequestCountAtCap
                        ? `${dashboard.attentionPullRequestCount}+`
                        : dashboard.attentionPullRequestCount}
                    </Badge>
                  {:else}
                    <span class="text-muted">Unknown</span>
                  {/if}
                </Table.Cell>
                <Table.Cell align="right">
                  {#if dashboard && dashboard.unresolvedThreadCount !== null}
                    {dashboard.openPullRequestCountAtCap
                      ? `${dashboard.unresolvedThreadCount}+`
                      : dashboard.unresolvedThreadCount}
                  {:else}
                    <span class="text-muted">Unknown</span>
                  {/if}
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
                        label="Repository watched"
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

  .section-heading {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--text-muted);
    margin: 0 0 var(--space-2);
  }

  .attention-list-wrapper {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .attention-badges {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
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
