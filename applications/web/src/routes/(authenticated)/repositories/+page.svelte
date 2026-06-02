<script lang="ts">
  import { Page } from '@tribunal/components/page';
  import { Card } from '@tribunal/components/card';
  import { Link } from '@tribunal/components/link';
  import { Badge } from '@tribunal/components/badge';
  import { Button } from '@tribunal/components/button';
  import { EmptyState } from '@tribunal/components/empty-state';
  import { FolderGit2 } from 'lucide-svelte';
  import GithubIcon from 'lucide-svelte/icons/github';
  import { Alert } from '@tribunal/components/alert';

  let { data } = $props();

  const repositories = $derived(data.repositories);
</script>

<Page title="Repositories" subtitle="Repositories from your GitHub App installations">
  {#if data.loadError}
    <Alert variant="danger">{data.loadError}</Alert>
  {/if}

  {#if repositories.length === 0}
    <Card flush>
      <EmptyState
        icon={FolderGit2}
        title={data.needsConnect ? 'Connect GitHub to get started' : 'No repositories yet'}
        description={data.needsConnect
          ? 'Install the GitHub App to give Tribunal access to your repositories.'
          : 'Install the GitHub App on a repository, then it will show up here.'}
      >
        {#snippet action()}
          <Button href="/connect/github" variant="primary" icon={GithubIcon}>
            {data.needsConnect ? 'Connect GitHub' : 'Add repositories'}
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
                  <Badge size="sm" code label={repository.defaultBranch} />
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
