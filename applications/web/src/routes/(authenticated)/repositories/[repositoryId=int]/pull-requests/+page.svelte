<script lang="ts">
  import Page from '$lib/components/page.svelte';
  import { Button } from '@lostgradient/cinder/button';
  import { Card } from '@lostgradient/cinder/card';
  import { Link } from '@lostgradient/cinder/link';
  import { Badge } from '@lostgradient/cinder/badge';
  import { EmptyState } from '@lostgradient/cinder/empty-state';
  import {
    GitPullRequest,
    GitMerge,
    MessageSquareText,
    CheckCircle2,
    CircleAlert,
  } from 'lucide-svelte';
  import Settings from 'lucide-svelte/icons/settings';

  let { data } = $props();

  const repositoryName = $derived(`${data.repository.owner}/${data.repository.name}`);
  const breadcrumbs = $derived([
    { label: 'Repositories', href: '/repositories' },
    { label: repositoryName },
  ]);

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

<Page
  title="Open pull requests"
  subtitle={`${data.pullRequests.length} open ${data.pullRequests.length === 1 ? 'pull request' : 'pull requests'}`}
  {breadcrumbs}
>
  {#snippet actions()}
    <Button href={`/repositories/${data.repository.id}/settings`} variant="secondary" size="sm">
      {#snippet leadingIcon()}<Settings size={14} aria-hidden="true" />{/snippet}
      Repository settings
    </Button>
  {/snippet}

  {#if data.pullRequests.length === 0}
    <Card padding="none">
      <EmptyState
        title="No open pull requests"
        description="When this repository has open pull requests, they will appear here."
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
              {#if pullRequest.draft}
                <Badge size="sm" variant="neutral">Draft</Badge>
              {:else}
                <Badge size="sm" variant="success">Open</Badge>
              {/if}
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
