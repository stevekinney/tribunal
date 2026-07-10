<script lang="ts">
  import Page from '$lib/components/page.svelte';
  import { enhance } from '$app/forms';
  import { Alert } from '@lostgradient/cinder/alert';
  import { Button } from '@lostgradient/cinder/button';
  import { Card } from '@lostgradient/cinder/card';
  import { Checkbox } from '@lostgradient/cinder/checkbox';
  import { Textarea } from '@lostgradient/cinder/textarea';
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
  import Save from 'lucide-svelte/icons/save';
  import WebhookIcon from 'lucide-svelte/icons/webhook';

  let { data, form } = $props();

  const repositoryName = $derived(`${data.repository.owner}/${data.repository.name}`);
  const breadcrumbs = $derived([
    { label: 'Repositories', href: '/repositories' },
    { label: repositoryName },
  ]);
  let ignoreGlobs = $derived(data.repository.review.ignoreGlobs.join('\n'));
  let selectedAgentIds = $derived(new Set(data.repository.review.agents.map((agent) => agent.id)));

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
  <Button href={`/repositories/${data.repository.id}/webhooks`} variant="secondary" size="sm">
    {#snippet leadingIcon()}<WebhookIcon size={14} aria-hidden="true" />{/snippet}
    Webhooks
  </Button>
{/snippet}

<Page
  title="Open pull requests"
  subtitle={`${data.pullRequests.length} open ${data.pullRequests.length === 1 ? 'pull request' : 'pull requests'}`}
  {breadcrumbs}
  actions={pageActions}
>
  {#if form?.error}
    <Alert variant="danger">{form.error}</Alert>
  {/if}

  <Card
    title="Repository settings"
    description="Controls how Tribunal reviews this repository."
    headingLevel={2}
  >
    <form method="POST" action="?/saveSettings" class="settings-form" use:enhance>
      <Textarea
        id="ignore-globs"
        name="ignoreGlobs"
        rows={4}
        label="Ignore globs"
        description="One glob per line. Matching files are skipped during review."
        placeholder="dist/**&#10;coverage/**"
        bind:value={ignoreGlobs}
      />

      <div class="agent-assignment">
        <span class="field-label">Review agents</span>
        {#if data.agents.length === 0}
          <p class="field-description">Create an agent before assigning repository reviewers.</p>
        {:else}
          <div class="agent-list">
            {#each data.agents as agent (agent.id)}
              {@const selected = selectedAgentIds.has(agent.id)}
              {@const canToggle = agent.enabled || selected}
              <Checkbox
                id="repository-agent-{agent.id}"
                name="agentIds"
                value={agent.id}
                checked={selected}
                label={agent.slug}
                disabled={!canToggle}
                description={agent.enabled
                  ? undefined
                  : selected
                    ? 'Disabled; uncheck to remove'
                    : 'Disabled'}
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
            {/each}
          </div>
        {/if}
      </div>

      <div class="settings-actions">
        <Button type="submit" variant="primary" size="sm">
          {#snippet leadingIcon()}<Save size={14} aria-hidden="true" />{/snippet}
          Save settings
        </Button>
      </div>
    </form>
  </Card>

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

  .settings-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .field-label {
    color: var(--text);
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
  }

  .field-description {
    color: var(--text-subtle);
    font-size: var(--text-sm);
    margin: 0;
  }

  .agent-assignment,
  .agent-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .settings-actions {
    display: flex;
    justify-content: flex-end;
  }
</style>
