<script lang="ts">
  import type { PageProps } from './$types';
  import { SvelteSet } from 'svelte/reactivity';
  import { enhance } from '$app/forms';
  import Page from '$lib/components/page.svelte';
  import { Card } from '@lostgradient/cinder/card';
  import { Link } from '@lostgradient/cinder/link';
  import { Badge } from '@lostgradient/cinder/badge';
  import { Button } from '@lostgradient/cinder/button';
  import { SearchField } from '@lostgradient/cinder/search-field';
  import { Combobox } from '@lostgradient/cinder/combobox';
  import { EmptyState } from '@lostgradient/cinder/empty-state';
  import { Skeleton } from '@lostgradient/cinder/skeleton';
  import { Table } from '@lostgradient/cinder/table';
  import { Tooltip } from '@lostgradient/cinder/tooltip';
  import { StatusDot } from '@lostgradient/cinder/status-dot';
  import type { StatusDotStatus } from '@lostgradient/cinder/status-dot';
  import { StatGroup } from '@lostgradient/cinder/stat-group';
  import { DataList } from '@lostgradient/cinder/data-list';
  import { StackedListItem } from '@lostgradient/cinder/stacked-list-item';
  import { Alert } from '@lostgradient/cinder/alert';
  import { CircleAlert, FolderGit2, Info, Plus, Search } from 'lucide-svelte';
  import GithubIcon from 'lucide-svelte/icons/github';
  import SettingsIcon from 'lucide-svelte/icons/settings';
  import WebhookIcon from 'lucide-svelte/icons/webhook';
  import type { DashboardUnavailableReason } from '@tribunal/github/dashboard/types';

  let { data, form }: PageProps = $props();

  let searchQuery = $state('');
  let repositoryToAddId = $state('');
  let repositoryToAddInput = $state('');

  // Only repositories explicitly added to Tribunal (watched) appear in the
  // table. The full accessible catalog is never rendered here — it lives behind
  // the "Add repository" picker as `data.addableRepositories`.
  //
  // `summary`, `attentionPullRequests`, and `dashboardRowsById` are Promises —
  // every GitHub-dependent field on this page. They're awaited directly in the
  // markup below (`{#await}`) rather than derived here, so the repository
  // identity and search below paint immediately while the dashboard fan-out
  // is still in flight.
  const repositories = $derived(data.repositories);
  const hasInstallations = $derived(data.installations.length > 0);
  // The Add picker only renders when there is something to add, so empty-state
  // copy must not point at it unless an addable repository actually exists.
  const hasAddableRepositories = $derived(data.addableRepositories.length > 0);

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
   * Plain-language reason a single repository's row is unavailable this
   * build, shown as a tooltip on the per-row warning indicator. Distinguishes
   * a deliberate skip (shared API budget spent, or GitHub rate-limited this
   * build) from an actual GitHub failure — these are different operational
   * situations and previously rendered identically as an unlabeled "Unknown".
   */
  function unavailableReasonMessage(reason: DashboardUnavailableReason | undefined): string {
    const map: Record<DashboardUnavailableReason, string> = {
      'no-installation': 'No GitHub installation is connected for this repository.',
      'api-budget-exhausted':
        "Skipped this build: Tribunal's shared GitHub API budget ran out before reaching this repository.",
      'rate-limited':
        'Skipped this build: GitHub rate-limited Tribunal partway through, so this repository was not checked.',
      'github-error': "GitHub returned an error while reading this repository's data.",
    };
    return reason
      ? map[reason]
      : "This repository's GitHub data could not be refreshed this build.";
  }

  /**
   * Build-wide phrasing of the same reasons, used by the top banner when
   * every unavailable repository this build shares one cause — naming it
   * beats a generic "some repositories" notice. When repositories disagree
   * on the reason, the banner falls back to pointing at each row's own
   * indicator instead of picking one repository's reason to feature.
   */
  function unavailableBannerMessage(reason: DashboardUnavailableReason): string {
    const map: Record<DashboardUnavailableReason, string> = {
      'no-installation':
        'One or more repositories have no GitHub installation connected. Reconnect them from “Manage repository access”.',
      'api-budget-exhausted':
        'Tribunal stopped checking repositories after using its shared GitHub API budget for this page load. Their status will refresh on the next load.',
      'rate-limited':
        'GitHub rate-limited Tribunal partway through this page load, so the remaining repositories were not checked. Their status will refresh on the next load.',
      'github-error':
        "GitHub returned an error while refreshing one or more repositories' data. Their status shows as Unknown until the next refresh.",
    };
    return map[reason];
  }

  /** Distinct `unavailableReason`s across every unavailable row this build, in first-seen order. */
  function distinctUnavailableReasons(
    reposToCheck: (typeof data.repositories)[number][],
    dashboardsById: Awaited<typeof data.dashboardRowsById>,
  ): DashboardUnavailableReason[] {
    const seen = new SvelteSet<DashboardUnavailableReason>();
    for (const repository of reposToCheck) {
      const dashboard = dashboardsById.get(repository.id);
      if (dashboard?.dataStatus === 'unavailable' && dashboard.unavailableReason) {
        seen.add(dashboard.unavailableReason);
      }
    }
    return [...seen];
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

  {#await data.dashboardRowsById then dashboardsById}
    {@const unavailableReasons = distinctUnavailableReasons(repositories, dashboardsById)}
    {#if unavailableReasons.length === 1}
      <Alert variant="warning">{unavailableBannerMessage(unavailableReasons[0])}</Alert>
    {:else if unavailableReasons.length > 1}
      <Alert variant="warning">
        GitHub data for some repositories could not be refreshed this build, for more than one
        reason. Check each affected repository's warning icon for why — search or filter to it if it
        isn't currently visible.
      </Alert>
    {/if}
  {/await}

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
    {#await data.summary}
      <div class="stat-group-skeleton" aria-hidden="true">
        <Skeleton height="3.5rem" width="100%" />
      </div>
    {:then summary}
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
          {#await data.attentionPullRequests}
            <div class="attention-list-skeleton" aria-hidden="true">
              <Skeleton height="2.5rem" width="100%" />
              <Skeleton height="2.5rem" width="100%" />
            </div>
          {:then attentionPullRequests}
            <DataList items={attentionPullRequests} key={(pr) => `${pr.repositoryId}:${pr.number}`}>
              {#snippet empty()}
                {#snippet attentionIcon()}<CircleAlert size={32} aria-hidden="true" />{/snippet}
                {#if summary && !summary.attentionPullRequestCountExact}
                  {#if summary.hasUnavailableRepositories}
                    <EmptyState
                      title="This list may be incomplete"
                      description="One or more repositories could not be checked this build. Check the affected repository's warning icon in the table for why — clear any search filter if it isn't currently visible."
                      icon={attentionIcon}
                    />
                  {:else if summary.hasUnanalyzedPullRequests}
                    <EmptyState
                      title="This list may be incomplete"
                      description="Some pull requests were found too recently to be analyzed yet. The count will fill in shortly."
                      icon={attentionIcon}
                    />
                  {:else}
                    <EmptyState
                      title="This list may be incomplete"
                      description="Some pull requests exceeded the per-repository results limit, so this list may be missing entries."
                      icon={attentionIcon}
                    />
                  {/if}
                {:else}
                  <EmptyState
                    title="Nothing needs attention"
                    description="No open pull requests need attention right now."
                    icon={attentionIcon}
                  />
                {/if}
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
                        variant={(pullRequest.unresolvedThreadCount ?? 0) > 0
                          ? 'warning'
                          : 'neutral'}
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
          {/await}
        </li>
      </ul>
    {/await}

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
      <Card padding="none">
        <EmptyState
          title="No matching repositories"
          description={`No repositories matching "${searchQuery}".`}
        >
          {#snippet icon()}<Search size={32} aria-hidden="true" />{/snippet}
        </EmptyState>
      </Card>
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
              <Table.HeaderCell align="right">Open pull requests</Table.HeaderCell>
              <Table.HeaderCell align="right" aria-label="Needs attention">
                <span class="header-with-help">
                  Needs attention
                  <Tooltip
                    text="A pull request needs attention when its own CI is failing or errored, it conflicts with the base branch, or it has unresolved review threads. Pending or unknown checks never count, and neither does age."
                  >
                    <Button variant="ghost" size="xs">
                      {#snippet leadingIcon()}<Info size={12} aria-hidden="true" />{/snippet}
                      <span class="cinder-sr-only">What counts as needing attention</span>
                    </Button>
                  </Tooltip>
                </span>
              </Table.HeaderCell>
              <Table.HeaderCell align="right">Unresolved threads</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {#each filteredRepositories as repository (repository.id)}
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
                    <Button
                      href={`/repositories/${repository.id}/settings`}
                      variant="ghost"
                      size="xs"
                    >
                      {#snippet leadingIcon()}<SettingsIcon
                          size={14}
                          aria-hidden="true"
                        />{/snippet}
                      <span class="cinder-sr-only">Repository settings</span>
                    </Button>
                  </div>
                </Table.Cell>
                {#await data.dashboardRowsById}
                  <Table.Cell><Skeleton height="1rem" width="5rem" /></Table.Cell>
                  <Table.Cell align="right"><Skeleton height="1rem" width="2rem" /></Table.Cell>
                  <Table.Cell align="right"><Skeleton height="1rem" width="2rem" /></Table.Cell>
                  <Table.Cell align="right"><Skeleton height="1rem" width="2rem" /></Table.Cell>
                {:then dashboardsById}
                  {@const dashboard = dashboardsById.get(repository.id) ?? null}
                  <Table.Cell>
                    <div class="ci-status-cell">
                      <StatusDot
                        status={ciStatusDotStatus(dashboard?.defaultBranchStatus ?? 'unknown')}
                        label={ciStatusLabel(dashboard?.defaultBranchStatus ?? 'unknown')}
                        showLabel
                        size="sm"
                      />
                      {#if dashboard?.dataStatus === 'unavailable'}
                        <Tooltip text={unavailableReasonMessage(dashboard.unavailableReason)}>
                          <Button variant="ghost" size="xs">
                            {#snippet leadingIcon()}<CircleAlert
                                size={14}
                                aria-hidden="true"
                              />{/snippet}
                            <span class="cinder-sr-only">Repository data unavailable</span>
                          </Button>
                        </Tooltip>
                      {/if}
                    </div>
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
                {/await}
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

  .stat-group-skeleton {
    display: flex;
  }

  .attention-list-skeleton {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
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

  .ci-status-cell {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }

  .header-with-help {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
  }

  .table-hint {
    font-size: var(--text-xs);
    color: var(--text-subtle);
  }
</style>
