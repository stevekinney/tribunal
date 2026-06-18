<script lang="ts">
  import Page from '$lib/components/page.svelte';
  import { Card } from '@lostgradient/cinder/card';
  import { Link } from '@lostgradient/cinder/link';
  import { Badge } from '@lostgradient/cinder/badge';
  import { Button } from '@lostgradient/cinder/button';
  import { EmptyState } from '@lostgradient/cinder/empty-state';
  import { FolderGit2, Save } from 'lucide-svelte';
  import GithubIcon from 'lucide-svelte/icons/github';
  import { Alert } from '@lostgradient/cinder/alert';

  let { data } = $props();

  const repositories = $derived(data.repositories);
  const agents = $derived(data.agents ?? []);
  const hasInstallations = $derived(data.installations.length > 0);
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
    <ul class="repository-list">
      {#each repositories as repository (repository.id)}
        <li>
          <Card>
            <div class="repository-row">
              <div class="repository-identity">
                <Link href={`/repositories/${repository.id}/pull-requests`}>
                  <span class="repository-owner">{repository.owner}</span>
                  <span class="repository-separator">/</span>
                  <span class="repository-name">{repository.name}</span>
                </Link>
                {#if repository.defaultBranch}
                  <Badge size="sm">{repository.defaultBranch}</Badge>
                {/if}
              </div>
              <div class="repository-meta">
                <Badge size="sm" variant={repository.review.watched ? 'success' : 'neutral'}>
                  {repository.review.watched ? 'Watched' : 'Not watched'}
                </Badge>
                <span class="installation-account">{repository.accountLogin}</span>
              </div>
            </div>

            <form method="POST" action="?/watch" class="repository-review-form">
              <input type="hidden" name="repositoryId" value={repository.id} />
              <label class="watch-control">
                <input type="checkbox" name="watched" checked={repository.review.watched} />
                <span>Watch pull requests</span>
              </label>

              <label class="field">
                <span>Assigned agents</span>
                <select name="agentIds" multiple size={Math.min(Math.max(agents.length, 3), 6)}>
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

              <label class="field">
                <span>Ignore globs</span>
                <textarea
                  name="ignoreGlobs"
                  rows="3"
                  spellcheck="false"
                  value={repository.review.ignoreGlobs.join('\n')}
                ></textarea>
              </label>

              <div class="review-summary">
                <span>Last run: {repository.review.lastRunStatus ?? 'none'}</span>
                <span>
                  30-day estimate: ${repository.review.estimatedCostLast30DaysUsd.toFixed(2)}
                </span>
                <Button type="submit" size="sm" variant="secondary">
                  Save
                  {#snippet leadingIcon()}<Save size={14} aria-hidden="true" />{/snippet}
                </Button>
              </div>
            </form>
          </Card>
        </li>
      {/each}
    </ul>
  {/if}
</Page>

<style>
  .repository-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    list-style: none;
  }

  .repository-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
  }

  .repository-identity {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
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

  .repository-meta {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-sm);
    color: var(--text-muted);
    white-space: nowrap;
  }

  .repository-review-form {
    display: grid;
    grid-template-columns: minmax(12rem, 1fr) minmax(12rem, 1fr);
    gap: var(--space-4);
    margin-top: var(--space-4);
    padding-top: var(--space-4);
    border-top: 1px solid var(--border-muted);
  }

  .watch-control {
    grid-column: 1 / -1;
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    font-weight: var(--font-medium);
    color: var(--text);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    font-size: var(--text-sm);
    color: var(--text-muted);
  }

  select,
  textarea {
    width: 100%;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface);
    color: var(--text);
    padding: var(--space-2) var(--space-3);
    font: inherit;
  }

  .review-summary {
    grid-column: 1 / -1;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    flex-wrap: wrap;
    gap: var(--space-3);
    font-size: var(--text-sm);
    color: var(--text-muted);
  }

  @media (max-width: 640px) {
    .repository-row,
    .review-summary {
      align-items: flex-start;
      flex-direction: column;
    }

    .repository-review-form {
      grid-template-columns: 1fr;
    }
  }
</style>
