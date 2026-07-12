<script lang="ts">
  import { untrack } from 'svelte';
  import Page from '$lib/components/page.svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { Button } from '@lostgradient/cinder/button';
  import { Card } from '@lostgradient/cinder/card';
  import { Link } from '@lostgradient/cinder/link';
  import { Badge } from '@lostgradient/cinder/badge';
  import { EmptyState } from '@lostgradient/cinder/empty-state';
  import { FacetedFilterBar } from '@lostgradient/cinder/faceted-filter-bar';
  import { Input } from '@lostgradient/cinder/input';
  import type { AppliedFilter, FacetDefinition } from '@lostgradient/cinder/faceted-filter-bar';
  import { Pagination } from '@lostgradient/cinder/pagination';
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

  const facets: FacetDefinition[] = [
    {
      type: 'select',
      key: 'pr_state',
      label: 'State',
      placeholder: 'Open',
      options: [
        { value: 'open', label: 'Open' },
        { value: 'closed', label: 'Closed' },
        { value: 'all', label: 'All' },
      ],
    },
    {
      type: 'select',
      key: 'pr_sort',
      label: 'Sort',
      placeholder: 'Updated',
      options: [
        { value: 'updated', label: 'Updated' },
        { value: 'created', label: 'Created' },
        { value: 'popularity', label: 'Popularity' },
        { value: 'long-running', label: 'Long-running' },
      ],
    },
    {
      type: 'select',
      key: 'pr_direction',
      label: 'Direction',
      placeholder: 'Descending',
      options: [
        { value: 'desc', label: 'Descending' },
        { value: 'asc', label: 'Ascending' },
      ],
    },
    { type: 'custom', key: 'pr_base', label: 'Base branch', control: baseBranchControl },
    { type: 'custom', key: 'pr_head', label: 'Head branch', control: headBranchControl },
    {
      type: 'select',
      key: 'pr_per_page',
      label: 'Page size',
      placeholder: '30 per page',
      options: [
        { value: '30', label: '30 per page' },
        { value: '50', label: '50 per page' },
        { value: '100', label: '100 per page' },
      ],
    },
  ];

  const appliedFilters = $derived.by(() => {
    const applied: AppliedFilter[] = [];
    if (data.filters.state !== DEFAULT_FILTERS.state) {
      applied.push({ key: 'pr_state', value: data.filters.state, label: 'State' });
    }
    if (data.filters.sort !== DEFAULT_FILTERS.sort) {
      applied.push({ key: 'pr_sort', value: data.filters.sort, label: 'Sort' });
    }
    if (data.filters.direction !== DEFAULT_FILTERS.direction) {
      applied.push({ key: 'pr_direction', value: data.filters.direction, label: 'Direction' });
    }
    if (data.filters.base) {
      applied.push({ key: 'pr_base', value: data.filters.base, label: 'Base branch' });
    }
    if (data.filters.head) {
      applied.push({ key: 'pr_head', value: data.filters.head, label: 'Head branch' });
    }
    if (data.filters.perPage !== DEFAULT_FILTERS.perPage) {
      applied.push({
        key: 'pr_per_page',
        value: String(data.filters.perPage),
        label: 'Page size',
      });
    }
    return applied;
  });

  // Keep rapid, back-to-back filter changes additive while $app/state waits
  // for the preceding navigation to land and update page.url.
  let pendingNavigationTarget: URL | undefined = $state();

  $effect(() => {
    void page.url;
    pendingNavigationTarget = undefined;
  });

  /**
   * Navigate to the same page with updated filter query params, resetting
   * pagination to page 1 whenever a filter (not the page itself) changes.
   */
  function updateFilters(
    next: Record<string, string | undefined>,
    options?: { resetPage?: boolean },
  ): void {
    const url = new URL(untrack(() => pendingNavigationTarget) ?? page.url);
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
    pendingNavigationTarget = url;
    goto(`${url.pathname}${url.search}`, { keepFocus: true, noScroll: true, invalidateAll: true });
  }

  function handleClearAll(): void {
    pendingNavigationTarget = undefined;
    goto(page.url.pathname, { keepFocus: true, noScroll: true, invalidateAll: true });
  }

  function handleFacetChange(key: string, value: string): void {
    updateFilters({ [key]: value || undefined });
  }

  function handleFilterRemove(key: string): void {
    updateFilters({ [key]: undefined });
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

{#snippet baseBranchControl({
  value,
  onchange,
}: {
  value: string;
  onchange: (value: string) => void;
})}
  <Input
    id="pull-request-base-branch-filter"
    label="Base branch"
    placeholder="main"
    value={value ?? ''}
    onchange={(event) => onchange(event.currentTarget.value)}
  />
{/snippet}

{#snippet headBranchControl({
  value,
  onchange,
}: {
  value: string;
  onchange: (value: string) => void;
})}
  <Input
    id="pull-request-head-branch-filter"
    label="Head branch"
    placeholder="owner:branch"
    value={value ?? ''}
    onchange={(event) => onchange(event.currentTarget.value)}
  />
{/snippet}

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
  <FacetedFilterBar
    aria-label="Pull request filters"
    showSearch={false}
    {facets}
    {appliedFilters}
    onfacetchange={handleFacetChange}
    onfilterremove={handleFilterRemove}
    onclearall={handleClearAll}
  />

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
