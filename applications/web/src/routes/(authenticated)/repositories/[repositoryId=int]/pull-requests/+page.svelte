<script lang="ts">
  import Page from '$lib/components/page.svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { Button } from '@lostgradient/cinder/button';
  import { Card } from '@lostgradient/cinder/card';
  import { Link } from '@lostgradient/cinder/link';
  import { Badge } from '@lostgradient/cinder/badge';
  import { EmptyState } from '@lostgradient/cinder/empty-state';
  import { Pagination } from '@lostgradient/cinder/pagination';
  import { Select } from '@lostgradient/cinder/select';
  import {
    GitPullRequest,
    GitMerge,
    MessageSquareText,
    CheckCircle2,
    CircleAlert,
  } from 'lucide-svelte';
  import Settings from 'lucide-svelte/icons/settings';
  import WebhookIcon from 'lucide-svelte/icons/webhook';
  import ZapIcon from 'lucide-svelte/icons/zap';

  let { data } = $props();

  const repositoryName = $derived(`${data.repository.owner}/${data.repository.name}`);
  const breadcrumbs = $derived([
    { label: 'Repositories', href: '/repositories' },
    { label: repositoryName },
  ]);

  const DEFAULT_FILTERS = {
    state: 'open',
    sort: 'updated',
    direction: 'desc',
    perPage: 30,
  } as const;

  const isFiltered = $derived(
    data.filters.state !== DEFAULT_FILTERS.state || !!data.filters.head || !!data.filters.base,
  );

  const subtitle = $derived(
    data.filters.page > 1
      ? `Showing page ${data.filters.page}`
      : isFiltered
        ? `Showing ${data.pullRequests.length} matching ${data.pullRequests.length === 1 ? 'pull request' : 'pull requests'}`
        : `Showing ${data.pullRequests.length} open ${data.pullRequests.length === 1 ? 'pull request' : 'pull requests'}`,
  );

  const stateOptions = [
    { value: 'open', label: 'Open' },
    { value: 'closed', label: 'Closed' },
    { value: 'all', label: 'All' },
  ] as const;

  const sortOptions = [
    { value: 'updated', label: 'Updated' },
    { value: 'created', label: 'Created' },
    { value: 'popularity', label: 'Popularity' },
    { value: 'long-running', label: 'Long-running' },
  ] as const;

  const directionOptions = [
    { value: 'desc', label: 'Descending' },
    { value: 'asc', label: 'Ascending' },
  ] as const;

  const perPageOptions: { value: string; label: string }[] = [
    { value: '30', label: '30 per page' },
    { value: '50', label: '50 per page' },
    { value: '100', label: '100 per page' },
  ];

  /**
   * Navigate to the same page with updated filter query params, resetting
   * pagination to page 1 whenever a filter (not the page itself) changes.
   */
  function updateFilters(
    next: Record<string, string | undefined>,
    options?: { resetPage?: boolean },
  ): void {
    const url = new URL(page.url);
    for (const [key, value] of Object.entries(next)) {
      if (value) {
        url.searchParams.set(key, value);
      } else {
        url.searchParams.delete(key);
      }
    }
    if (options?.resetPage !== false) {
      url.searchParams.set('pr_page', '1');
    }
    goto(`${url.pathname}${url.search}`, { keepFocus: true, noScroll: true, invalidateAll: true });
  }

  function handleClearAll(): void {
    goto(page.url.pathname, { keepFocus: true, noScroll: true, invalidateAll: true });
  }

  let currentPage = $derived(data.filters.page);

  $effect(() => {
    if (currentPage !== data.filters.page) {
      updateFilters({ pr_page: String(currentPage) }, { resetPage: false });
    }
  });

  function pullRequestStateLabel(pullRequest: {
    state: 'open' | 'closed';
    draft: boolean;
    mergedAt: string | null;
  }): string {
    if (pullRequest.state === 'closed') {
      return pullRequest.mergedAt ? 'Merged' : 'Closed';
    }
    return pullRequest.draft ? 'Draft' : 'Open';
  }

  function pullRequestStateVariant(pullRequest: {
    state: 'open' | 'closed';
    draft: boolean;
    mergedAt: string | null;
  }): 'success' | 'neutral' | 'info' {
    if (pullRequest.state === 'closed') {
      return pullRequest.mergedAt ? 'info' : 'neutral';
    }
    return pullRequest.draft ? 'neutral' : 'success';
  }

  function ciLabel(status: string): string {
    const labels: Record<string, string> = {
      passing: 'CI passing',
      failing: 'CI failing',
      pending: 'CI pending',
      unknown: 'CI unknown',
    };
    return labels[status] ?? 'CI unknown';
  }

  function ciVariant(status: string): 'success' | 'danger' | 'warning' | 'neutral' {
    if (status === 'passing') return 'success';
    if (status === 'failing') return 'danger';
    if (status === 'pending') return 'warning';
    return 'neutral';
  }

  function conflictLabel(status: string, baseRef: string): string {
    if (status === 'clean') return 'No conflicts';
    if (status === 'conflicting') return `Conflicts with ${baseRef}`;
    return 'Conflict status unknown';
  }

  function conflictVariant(status: string): 'success' | 'danger' | 'neutral' {
    if (status === 'clean') return 'success';
    if (status === 'conflicting') return 'danger';
    return 'neutral';
  }
</script>

{#snippet pageActions()}
  <Link href={`/repositories/${data.repository.id}/issues`}>Issues</Link>
  <Button href={`/repositories/${data.repository.id}/events`} variant="secondary" size="sm">
    {#snippet leadingIcon()}<ZapIcon size={14} aria-hidden="true" />{/snippet}
    Events
  </Button>
  <Button href={`/repositories/${data.repository.id}/webhooks`} variant="secondary" size="sm">
    {#snippet leadingIcon()}<WebhookIcon size={14} aria-hidden="true" />{/snippet}
    Webhooks
  </Button>
  <Button href={`/repositories/${data.repository.id}/settings`} variant="secondary" size="sm">
    {#snippet leadingIcon()}<Settings size={14} aria-hidden="true" />{/snippet}
    Repository settings
  </Button>
{/snippet}

<Page title="Pull requests" {subtitle} {breadcrumbs} actions={pageActions}>
  <div class="pull-request-filters" role="search" aria-label="Pull request filters">
    <Select
      id="pr-filter-state"
      label="State"
      value={data.filters.state}
      options={stateOptions}
      onchange={(event: Event) =>
        updateFilters({ pr_state: (event.currentTarget as HTMLSelectElement).value })}
    />
    <Select
      id="pr-filter-sort"
      label="Sort"
      value={data.filters.sort}
      options={sortOptions}
      onchange={(event: Event) =>
        updateFilters({ pr_sort: (event.currentTarget as HTMLSelectElement).value })}
    />
    <Select
      id="pr-filter-direction"
      label="Direction"
      value={data.filters.direction}
      options={directionOptions}
      onchange={(event: Event) =>
        updateFilters({ pr_direction: (event.currentTarget as HTMLSelectElement).value })}
    />
    <label class="branch-filter">
      <span class="branch-filter-label">Base branch</span>
      <input
        type="text"
        class="branch-input"
        placeholder="main"
        value={data.filters.base ?? ''}
        onchange={(event) => updateFilters({ pr_base: event.currentTarget.value || undefined })}
      />
    </label>
    <label class="branch-filter">
      <span class="branch-filter-label">Head branch</span>
      <input
        type="text"
        class="branch-input"
        placeholder="owner:branch"
        value={data.filters.head ?? ''}
        onchange={(event) => updateFilters({ pr_head: event.currentTarget.value || undefined })}
      />
    </label>
    <Select
      id="pr-filter-per-page"
      label="Page size"
      value={String(data.filters.perPage)}
      options={perPageOptions}
      onchange={(event: Event) =>
        updateFilters({ pr_per_page: (event.currentTarget as HTMLSelectElement).value })}
    />
    {#if isFiltered}
      <Button variant="secondary" size="sm" onclick={handleClearAll}>Clear filters</Button>
    {/if}
  </div>

  {#if data.pullRequests.length === 0}
    <Card padding="none">
      <EmptyState
        title={isFiltered ? 'No pull requests match these filters' : 'No open pull requests'}
        description={isFiltered
          ? 'Try widening the state, base branch, or head branch filters.'
          : 'When this repository has open pull requests, they will appear here.'}
      >
        {#snippet icon()}<GitPullRequest size={48} />{/snippet}
      </EmptyState>
    </Card>
  {:else}
    <ul class="pull-request-list">
      {#each data.pullRequests as pullRequest (pullRequest.number)}
        <li>
          <Card>
            <div class="pull-request-row">
              <div class="pull-request-main">
                <Link href={pullRequest.htmlUrl} external>
                  <span class="pull-request-title">{pullRequest.title}</span>
                </Link>
                <div class="pull-request-meta">
                  <span class="pull-request-number">#{pullRequest.number}</span>
                  {#if pullRequest.author}
                    <span class="pull-request-author">by {pullRequest.author.login}</span>
                  {/if}
                  <span class="pull-request-branches">
                    {pullRequest.headRef} &rarr; {pullRequest.baseRef}
                  </span>
                </div>
              </div>
              <Badge size="sm" variant={pullRequestStateVariant(pullRequest)}>
                {pullRequestStateLabel(pullRequest)}
              </Badge>
            </div>
            <div class="status-row" aria-label="Pull request status">
              <Badge size="sm" variant={ciVariant(pullRequest.status.ciStatus)}>
                {#if pullRequest.status.ciStatus === 'failing'}
                  <CircleAlert size={13} aria-hidden="true" />
                {:else}
                  <CheckCircle2 size={13} aria-hidden="true" />
                {/if}
                {ciLabel(pullRequest.status.ciStatus)}
                {#if pullRequest.status.checkCount > 0}
                  ({pullRequest.status.checkCount})
                {/if}
              </Badge>
              {#if pullRequest.status.unresolvedReviewThreadCount === null}
                <Badge size="sm" variant="neutral">
                  <MessageSquareText size={13} aria-hidden="true" />
                  Threads unknown
                </Badge>
              {:else}
                <Badge
                  size="sm"
                  variant={pullRequest.status.unresolvedReviewThreadCount > 0
                    ? 'warning'
                    : 'success'}
                >
                  <MessageSquareText size={13} aria-hidden="true" />
                  {pullRequest.status.unresolvedReviewThreadCount} unresolved
                </Badge>
                {#if pullRequest.status.resolvedReviewThreadCount !== null}
                  <Badge size="sm" variant="neutral">
                    <MessageSquareText size={13} aria-hidden="true" />
                    {pullRequest.status.resolvedReviewThreadCount} resolved
                  </Badge>
                {/if}
              {/if}
              <Badge size="sm" variant={conflictVariant(pullRequest.status.mergeConflictStatus)}>
                <GitMerge size={13} aria-hidden="true" />
                {conflictLabel(pullRequest.status.mergeConflictStatus, pullRequest.baseRef)}
              </Badge>
            </div>
          </Card>
        </li>
      {/each}
    </ul>
  {/if}

  {#if data.hasNextPage || data.filters.page > 1}
    <Pagination
      bind:currentPage
      hasNextPage={data.hasNextPage}
      hasPreviousPage={data.filters.page > 1}
    />
  {/if}
</Page>

<style>
  .pull-request-filters {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: var(--space-3);
    margin-bottom: var(--space-4);
  }

  .branch-filter {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .branch-filter-label {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--text);
  }

  .branch-input {
    height: var(--cinder-control-height-sm, 2rem);
    padding-inline: var(--space-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface);
    color: var(--text);
    font-size: var(--text-sm);
    min-width: 8rem;
  }

  .pull-request-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    list-style: none;
  }

  .pull-request-row {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-4);
  }

  .status-row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin-top: var(--space-3);
  }

  .pull-request-main {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
  }

  .pull-request-title {
    font-weight: var(--font-medium);
    color: var(--text);
  }

  .pull-request-meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-sm);
    color: var(--text-muted);
  }

  .pull-request-branches {
    font-family: var(--font-mono, monospace);
    font-size: var(--text-xs);
    color: var(--text-subtle);
  }
</style>
