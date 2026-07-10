<script lang="ts">
  import { onDestroy } from 'svelte';
  import Page from '$lib/components/page.svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { formatRelativeDate } from '$lib/utilities';
  import { Card } from '@lostgradient/cinder/card';
  import { Link } from '@lostgradient/cinder/link';
  import { Badge } from '@lostgradient/cinder/badge';
  import { Chip } from '@lostgradient/cinder/chip';
  import { EmptyState } from '@lostgradient/cinder/empty-state';
  import { Table } from '@lostgradient/cinder/table';
  import { Pagination } from '@lostgradient/cinder/pagination';
  import { FacetedFilterBar } from '@lostgradient/cinder/faceted-filter-bar';
  import type { AppliedFilter, FacetDefinition } from '@lostgradient/cinder/faceted-filter-bar';
  import CircleDot from 'lucide-svelte/icons/circle-dot';

  let { data } = $props();

  const repositoryName = $derived(`${data.repository.owner}/${data.repository.name}`);
  const breadcrumbs = $derived([
    { label: 'Repositories', href: '/repositories' },
    { label: repositoryName, href: `/repositories/${data.repository.id}/pull-requests` },
    { label: 'Issues' },
  ]);

  const DEFAULT_FILTERS = {
    state: 'open',
    sort: 'updated',
    direction: 'desc',
    perPage: 30,
  } as const;

  const isFiltered = $derived(
    data.filters.state !== DEFAULT_FILTERS.state ||
      !!data.filters.assignee ||
      !!data.filters.labels ||
      !!data.filters.milestone ||
      !!data.filters.type ||
      !!data.filters.creator ||
      !!data.filters.mentioned,
  );

  const subtitle = $derived(
    isFiltered
      ? `Showing ${data.issues.length} matching ${data.issues.length === 1 ? 'issue' : 'issues'}`
      : `Showing ${data.issues.length} open ${data.issues.length === 1 ? 'issue' : 'issues'}`,
  );

  const facets: FacetDefinition[] = [
    {
      type: 'select',
      key: 'issue_state',
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
      key: 'issue_sort',
      label: 'Sort',
      placeholder: 'Updated',
      options: [
        { value: 'updated', label: 'Updated' },
        { value: 'created', label: 'Created' },
        { value: 'comments', label: 'Comments' },
      ],
    },
    {
      type: 'select',
      key: 'issue_direction',
      label: 'Direction',
      placeholder: 'Descending',
      options: [
        { value: 'desc', label: 'Descending' },
        { value: 'asc', label: 'Ascending' },
      ],
    },
    {
      type: 'custom',
      key: 'issue_assignee',
      label: 'Assignee',
      control: assigneeControl,
    },
    {
      type: 'select',
      key: 'issue_per_page',
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
      applied.push({ key: 'issue_state', value: data.filters.state, label: 'State' });
    }
    if (data.filters.sort !== DEFAULT_FILTERS.sort) {
      applied.push({ key: 'issue_sort', value: data.filters.sort, label: 'Sort' });
    }
    if (data.filters.direction !== DEFAULT_FILTERS.direction) {
      applied.push({ key: 'issue_direction', value: data.filters.direction, label: 'Direction' });
    }
    if (data.filters.assignee) {
      applied.push({ key: 'issue_assignee', value: data.filters.assignee, label: 'Assignee' });
    }
    if (data.filters.perPage !== DEFAULT_FILTERS.perPage) {
      applied.push({
        key: 'issue_per_page',
        value: String(data.filters.perPage),
        label: 'Page size',
      });
    }
    // These filters have no dedicated facet control yet, but a URL can still
    // carry them (e.g. a bookmarked/shared link). Surface them as removable
    // chips so an active filter is never invisible.
    if (data.filters.creator) {
      applied.push({ key: 'issue_creator', value: data.filters.creator, label: 'Creator' });
    }
    if (data.filters.mentioned) {
      applied.push({ key: 'issue_mentioned', value: data.filters.mentioned, label: 'Mentions' });
    }
    if (data.filters.milestone) {
      applied.push({ key: 'issue_milestone', value: data.filters.milestone, label: 'Milestone' });
    }
    if (data.filters.type) {
      applied.push({ key: 'issue_type', value: data.filters.type, label: 'Issue type' });
    }
    return applied;
  });

  // Target of the most recently issued (but not yet landed) navigation. When
  // two filter changes happen back-to-back, `$app/state`'s `page.url` does
  // not update until the first `goto` finishes loading, so building the
  // second navigation from `page.url` would drop the first change. Basing
  // each navigation on the last *issued* target instead keeps rapid changes
  // additive instead of clobbering.
  let pendingNavigationTarget: URL | undefined = $state();

  $effect(() => {
    // `page.url` only changes once a navigation actually lands, so treat
    // that as the signal that the pending target is now authoritative and
    // stop overriding it. Reading `page.url` here (rather than clearing on
    // the `goto()` promise settling) ties the reset to real navigation
    // completion instead of arbitrary promise-resolution timing.
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
    // A pending label debounce reads `page.url` when it eventually fires. If
    // another filter change navigates first, `page.url` is still the
    // pre-navigation URL until that load completes, so the debounced label
    // update would silently drop this change. Flush/cancel it first so every
    // navigation is built from the same up-to-date filter state.
    clearTimeout(labelsDebounceHandle);
    const url = new URL(pendingNavigationTarget ?? page.url);
    for (const [key, value] of Object.entries(next)) {
      if (value) {
        url.searchParams.set(key, value);
      } else {
        url.searchParams.delete(key);
      }
    }
    if (options?.resetPage !== false) {
      url.searchParams.set('issue_page', '1');
    }
    pendingNavigationTarget = url;
    goto(`${url.pathname}${url.search}`, { keepFocus: true, noScroll: true, invalidateAll: true });
  }

  function handleFacetChange(key: string, value: string): void {
    updateFilters({ [key]: value || undefined });
  }

  function handleFilterRemove(key: string): void {
    updateFilters({ [key]: undefined });
  }

  function handleClearAll(): void {
    clearTimeout(labelsDebounceHandle);
    pendingNavigationTarget = undefined;
    goto(page.url.pathname, { keepFocus: true, noScroll: true, invalidateAll: true });
  }

  let labelsInput = $derived(data.filters.labels ?? '');
  let labelsDebounceHandle: ReturnType<typeof setTimeout> | undefined;

  function handleLabelsChange(value: string): void {
    labelsInput = value;
    clearTimeout(labelsDebounceHandle);
    labelsDebounceHandle = setTimeout(() => {
      updateFilters({ issue_labels: value || undefined });
    }, 400);
  }

  onDestroy(() => clearTimeout(labelsDebounceHandle));

  let currentPage = $derived(data.filters.page);

  $effect(() => {
    if (currentPage !== data.filters.page) {
      updateFilters({ issue_page: String(currentPage) }, { resetPage: false });
    }
  });
</script>

{#snippet assigneeControl({
  value,
  onchange,
}: {
  value: string;
  onchange: (value: string) => void;
})}
  <input
    type="text"
    class="assignee-input"
    placeholder="Assignee username"
    aria-label="Assignee"
    value={value ?? ''}
    onchange={(event) => onchange(event.currentTarget.value)}
    onkeydown={(event) => {
      if (event.key === 'Enter') {
        event.currentTarget.blur();
      }
    }}
  />
{/snippet}

<Page title="Issues" {subtitle} {breadcrumbs}>
  <FacetedFilterBar
    aria-label="Issue filters"
    {facets}
    {appliedFilters}
    searchQuery={labelsInput}
    searchPlaceholder="Filter by label (comma-separated)…"
    searchAriaLabel="Labels"
    onsearchchange={handleLabelsChange}
    onfacetchange={handleFacetChange}
    onfilterremove={handleFilterRemove}
    onclearall={handleClearAll}
  />

  {#if data.issues.length === 0}
    <Card padding="none">
      <EmptyState
        title={data.hasNextPage
          ? 'No issues on this page'
          : data.filters.page > 1
            ? 'This page is empty'
            : isFiltered
              ? 'No issues match these filters'
              : 'No open issues'}
        description={data.hasNextPage
          ? 'This page was filled entirely by pull requests. Continue to the next page to see more issues.'
          : data.filters.page > 1
            ? 'Issues may have been closed or the page number is out of range. Go back to the first page to see current issues.'
            : isFiltered
              ? 'Try widening the state, assignee, or label filters.'
              : 'When this repository has open issues, they will appear here.'}
      >
        {#snippet icon()}<CircleDot size={48} />{/snippet}
      </EmptyState>
    </Card>
  {:else}
    <Card padding="none">
      <Table density="comfortable">
        <Table.Header>
          <Table.Row>
            <Table.HeaderCell>Issue</Table.HeaderCell>
            <Table.HeaderCell>Author</Table.HeaderCell>
            <Table.HeaderCell>Labels</Table.HeaderCell>
            <Table.HeaderCell>Assignees</Table.HeaderCell>
            <Table.HeaderCell align="right">Comments</Table.HeaderCell>
            <Table.HeaderCell>Updated</Table.HeaderCell>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {#each data.issues as issue (issue.number)}
            <Table.Row>
              <Table.Cell>
                <div class="issue-title-cell">
                  <Link href={issue.htmlUrl} external>
                    <span class="issue-title">{issue.title}</span>
                  </Link>
                  <div class="issue-meta">
                    <span class="issue-number">#{issue.number}</span>
                    {#if issue.milestone}
                      <span class="issue-milestone">{issue.milestone.title}</span>
                    {/if}
                    {#if issue.issueType}
                      <Badge size="xs" variant="info">{issue.issueType}</Badge>
                    {/if}
                  </div>
                </div>
              </Table.Cell>
              <Table.Cell>
                {#if issue.author}
                  <Link href={issue.author.htmlUrl} external>{issue.author.login}</Link>
                {:else}
                  <span class="issue-muted">Unknown</span>
                {/if}
              </Table.Cell>
              <Table.Cell>
                {#if issue.labels.length === 0}
                  <span class="issue-muted">None</span>
                {:else}
                  <div class="issue-labels">
                    {#each issue.labels as label (label.name)}
                      <Chip mode="display" label={label.name} size="sm" variant="neutral" />
                    {/each}
                  </div>
                {/if}
              </Table.Cell>
              <Table.Cell>
                {#if issue.assignees.length === 0}
                  <span class="issue-muted">Unassigned</span>
                {:else}
                  {issue.assignees.map((assignee) => assignee.login).join(', ')}
                {/if}
              </Table.Cell>
              <Table.Cell align="right">{issue.commentCount}</Table.Cell>
              <Table.Cell>
                <span title={issue.updatedAt}>{formatRelativeDate(issue.updatedAt)}</span>
              </Table.Cell>
            </Table.Row>
          {/each}
        </Table.Body>
      </Table>
    </Card>
  {/if}

  {#if data.hasNextPage || data.filters.page > 1}
    <!--
      Pagination is independent of the current page's row count: GitHub paginates
      before pull requests are filtered out of the issues response, so a page can
      render zero issues while a later page still has real issues (hasNextPage).
    -->
    <Pagination
      bind:currentPage
      hasNextPage={data.hasNextPage}
      hasPreviousPage={data.filters.page > 1}
    />
  {/if}
</Page>

<style>
  .assignee-input {
    height: var(--cinder-control-height-sm, 2rem);
    padding-inline: var(--space-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface);
    color: var(--text);
    font-size: var(--text-sm);
    min-width: 10rem;
  }

  .issue-title-cell {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
  }

  .issue-title {
    font-weight: var(--font-medium);
    color: var(--text);
  }

  .issue-meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-xs);
    color: var(--text-subtle);
  }

  .issue-labels {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
  }

  .issue-muted {
    color: var(--text-subtle);
    font-size: var(--text-sm);
  }
</style>
