<script lang="ts">
  import type { PageProps } from './$types';
  import { enhance } from '$app/forms';
  import Page from '$lib/components/page.svelte';
  import { Card } from '@lostgradient/cinder/card';
  import { Link } from '@lostgradient/cinder/link';
  import { Badge } from '@lostgradient/cinder/badge';
  import { Button } from '@lostgradient/cinder/button';
  import { SearchField } from '@lostgradient/cinder/search-field';
  import { EmptyState } from '@lostgradient/cinder/empty-state';
  import { Table } from '@lostgradient/cinder/table';
  import { FolderGit2, Plus, Eye, EyeOff } from 'lucide-svelte';
  import GithubIcon from 'lucide-svelte/icons/github';
  import { Alert } from '@lostgradient/cinder/alert';

  let { data, form }: PageProps = $props();

  let searchQuery = $state('');
  let showSearch = $state(false);

  const repositories = $derived(data.repositories);
  const hasInstallations = $derived(data.installations.length > 0);
  const watchedRepositories = $derived(repositories.filter((r) => r.review.watched));
  const searchVisible = $derived(showSearch || watchedRepositories.length === 0);

  const searchResults = $derived.by(() => {
    if (!searchQuery.trim()) return [];
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
</script>

<Page title="Repositories" subtitle="Repositories from your GitHub App installations">
  {#if data.loadError}
    <Alert variant="error">{data.loadError}</Alert>
  {/if}

  {#if form?.error}
    <Alert variant="error">{form.error}</Alert>
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
    <section class="watched-section">
      <div class="section-header">
        <h2 class="section-title">
          Watched repositories
          <Badge size="sm">{watchedRepositories.length}</Badge>
        </h2>
        <Button
          variant="secondary"
          size="sm"
          aria-expanded={searchVisible}
          aria-controls="search-section"
          onclick={() => (showSearch = !showSearch)}
        >
          {#snippet leadingIcon()}
            {#if searchVisible}<EyeOff size={14} aria-hidden="true" />{:else}<Plus
                size={14}
                aria-hidden="true"
              />{/if}
          {/snippet}
          {searchVisible ? 'Close' : 'Add repository'}
        </Button>
      </div>

      {#if watchedRepositories.length === 0}
        <p class="empty-hint">
          No repositories are being watched yet. Use the search below to add repositories to
          Tribunal.
        </p>
      {:else}
        <Card padding="none">
          <Table density="comfortable">
            <Table.Header>
              <Table.HeaderCell>Repository</Table.HeaderCell>
              <Table.HeaderCell>Branch</Table.HeaderCell>
              <Table.HeaderCell>Last run</Table.HeaderCell>
              <Table.HeaderCell align="right">30-day cost</Table.HeaderCell>
            </Table.Header>
            <Table.Body>
              {#each watchedRepositories as repository (repository.id)}
                <Table.Row>
                  <Table.Cell>
                    <Link href={`/repositories/${repository.id}/pull-requests`}>
                      <span class="repository-owner">{repository.owner}</span>
                      <span class="repository-separator">/</span>
                      <span class="repository-name">{repository.name}</span>
                    </Link>
                  </Table.Cell>
                  <Table.Cell>
                    {#if repository.defaultBranch}
                      <Badge size="sm">{repository.defaultBranch}</Badge>
                    {/if}
                  </Table.Cell>
                  <Table.Cell>
                    <span class="text-muted">
                      {repository.review.lastRunStatus ?? 'Never'}
                    </span>
                  </Table.Cell>
                  <Table.Cell align="right">
                    ${repository.review.estimatedCostLast30DaysUsd.toFixed(2)}
                  </Table.Cell>
                </Table.Row>
              {/each}
            </Table.Body>
          </Table>
        </Card>
      {/if}
    </section>

    {#if searchVisible}
      <section class="search-section" id="search-section">
        <h2 class="section-title">Find a repository</h2>
        <SearchField
          id="repository-search"
          value={searchQuery}
          placeholder="Search by owner or name…"
          oninput={(value) => (searchQuery = value)}
        />

        {#if searchQuery.trim() && searchResults.length === 0}
          <p class="empty-hint">No repositories matching "{searchQuery}".</p>
        {:else if searchResults.length > 0}
          <ul class="search-results">
            {#each searchResults as repository (repository.id)}
              <li class="search-result-item">
                <div class="search-result-identity">
                  <span class="repository-owner">{repository.owner}</span>
                  <span class="repository-separator">/</span>
                  <span class="repository-name">{repository.name}</span>
                  {#if repository.review.watched}
                    <Badge size="sm" variant="success">Watched</Badge>
                  {/if}
                </div>
                <form method="POST" action="?/watch" class="search-result-action" use:enhance>
                  <input type="hidden" name="repositoryId" value={repository.id} />
                  <input
                    type="hidden"
                    name="watched"
                    value={repository.review.watched ? '' : 'on'}
                  />
                  <input
                    type="hidden"
                    name="ignoreGlobs"
                    value={repository.review.ignoreGlobs.join('\n')}
                  />
                  {#each repository.review.agents as agent (agent.id)}
                    <input type="hidden" name="agentIds" value={agent.id} />
                  {/each}
                  <Button
                    type="submit"
                    variant={repository.review.watched ? 'ghost' : 'secondary'}
                    size="sm"
                  >
                    {#snippet leadingIcon()}
                      {#if repository.review.watched}<EyeOff
                          size={14}
                          aria-hidden="true"
                        />{:else}<Eye size={14} aria-hidden="true" />{/if}
                    {/snippet}
                    {repository.review.watched ? 'Unwatch' : 'Watch'}
                  </Button>
                </form>
              </li>
            {/each}
          </ul>
        {:else}
          <p class="empty-hint">Type to search across all accessible repositories.</p>
        {/if}
      </section>
    {/if}
  {/if}
</Page>

<style>
  .section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
  }

  .section-title {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-base);
    font-weight: var(--font-semibold);
    color: var(--text);
  }

  .empty-hint {
    font-size: var(--text-sm);
    color: var(--text-muted);
  }

  .repository-owner {
    color: var(--text-muted);
  }

  .repository-separator {
    color: var(--text-disabled);
  }

  .repository-name {
    font-weight: var(--font-medium);
    color: var(--text);
  }

  .text-muted {
    color: var(--text-muted);
    font-size: var(--text-sm);
  }

  .search-section {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .search-results {
    display: flex;
    flex-direction: column;
    list-style: none;
  }

  .search-result-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    padding: var(--space-3) var(--space-4);
    border-bottom: 1px solid var(--border-muted);
  }

  .search-result-item:last-child {
    border-bottom: none;
  }

  .search-result-identity {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
  }

  .search-result-action {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    flex-shrink: 0;
  }
</style>
