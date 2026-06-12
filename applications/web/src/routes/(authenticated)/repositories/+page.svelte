<script lang="ts">
  import Page from '$lib/components/page.svelte';
  import { Card } from '@lostgradient/cinder/card';
  import { Link } from '@lostgradient/cinder/link';
  import { Badge } from '@lostgradient/cinder/badge';
  import { Button } from '@lostgradient/cinder/button';
  import { EmptyState } from '@lostgradient/cinder/empty-state';
  import { FolderGit2 } from 'lucide-svelte';
  import GithubIcon from 'lucide-svelte/icons/github';
  import { Alert } from '@lostgradient/cinder/alert';

  let { data } = $props();

  const repositories = $derived(data.repositories);
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
                <span class="installation-account">{repository.accountLogin}</span>
              </div>
            </div>
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
</style>
