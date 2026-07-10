<script lang="ts">
  import type { PageProps } from './$types';
  import { untrack } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import { enhance } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import { Badge } from '@lostgradient/cinder/badge';
  import { Button } from '@lostgradient/cinder/button';
  import { Checkbox } from '@lostgradient/cinder/checkbox';
  import { SearchField } from '@lostgradient/cinder/search-field';
  import { EmptyState } from '@lostgradient/cinder/empty-state';
  import { Steps } from '@lostgradient/cinder/steps';
  import FolderGit2 from 'lucide-svelte/icons/folder-git-2';
  import Gavel from 'lucide-svelte/icons/gavel';
  import GitBranch from 'lucide-svelte/icons/git-branch';
  import GithubIcon from 'lucide-svelte/icons/github';

  let { data, form }: PageProps = $props();

  // Pre-select repositories that are already being watched. untrack keeps this a
  // one-time seed (the set is then user-mutated) and avoids state_referenced_locally.
  const selectedIds = new SvelteSet<number>(
    untrack(() => data.repositories.filter((r) => r.watched).map((r) => r.id)),
  );

  let searchQuery = $state('');

  const filteredRepositories = $derived.by(() => {
    if (!searchQuery.trim()) return data.repositories;
    const query = searchQuery.toLowerCase();
    return data.repositories.filter(
      (r) =>
        r.name.toLowerCase().includes(query) ||
        r.owner.toLowerCase().includes(query) ||
        `${r.owner}/${r.name}`.toLowerCase().includes(query),
    );
  });

  const selectedCount = $derived(selectedIds.size);
  const canSubmit = $derived(selectedIds.size > 0);

  const currentStep = $derived.by(() => {
    const reason = data.connectReason;
    switch (reason) {
      case 'disconnected':
      case 'unavailable':
        return 0;
      case 'no_installation':
        return 1;
      case 'no_repositories':
      case null:
        return 2;
      default:
        reason satisfies never;
        return 0;
    }
  });

  const onboardingSteps = [
    { id: 'sign-in', label: 'Sign in with GitHub' },
    { id: 'install', label: 'Install the GitHub App' },
    { id: 'choose', label: 'Choose repositories to monitor' },
  ];

  // Display label for the connected GitHub account(s).
  const accountLabel = $derived(
    data.installations.length === 1
      ? data.installations[0].accountLogin
      : data.installations.length > 1
        ? `${data.installations.length} accounts`
        : null,
  );

  const repoCountLabel = $derived(
    `${data.repositories.length} ${data.repositories.length === 1 ? 'repository' : 'repositories'}`,
  );

  // Connect-prompt copy keyed off the load's discriminated reason. `null` means
  // the connection is healthy and the repository picker is shown instead. Each
  // reason gets honest copy: reconnect a dead connection, retry a transient
  // outage, or install the app when none is installed.
  const connectPrompt = $derived.by(() => {
    // Switch on a local copy of the discriminant: exhausting `data.connectReason`
    // directly would narrow `data` itself to `never` in the default arm (PageData
    // is a discriminated union of the load's return shapes), so the local keeps
    // the exhaustiveness assertion readable.
    const reason = data.connectReason;
    switch (reason) {
      case 'disconnected':
        return {
          title: 'Reconnect your GitHub account',
          description:
            'Your GitHub connection has expired or was revoked. Reconnect to let Tribunal see your repositories.',
          ctaLabel: 'Reconnect GitHub',
          ctaHref: '/connect/github',
        };
      case 'unavailable':
        return {
          title: 'Could not reach GitHub',
          description:
            'We hit an error talking to GitHub. This is usually temporary — try again in a moment.',
          ctaLabel: 'Try again',
          ctaHref: null,
        };
      case 'no_installation':
        return {
          title: 'Install the GitHub App',
          description: 'Install the Tribunal GitHub App to make your repositories accessible.',
          ctaLabel: 'Install GitHub App',
          ctaHref: '/connect/github',
        };
      case 'no_repositories':
        return {
          title: 'Grant repository access',
          description:
            "The Tribunal GitHub App is installed but can't see any repositories yet. Grant it access to the repositories you want to add to Tribunal.",
          ctaLabel: 'Manage repository access',
          ctaHref: '/connect/github',
        };
      case null:
        // Healthy connection — render the repository picker, not a prompt.
        return null;
      default:
        // Compile-time exhaustiveness: a new connectReason must be handled here.
        reason satisfies never;
        return null;
    }
  });
</script>

<svelte:head>
  <title>Choose repositories - Tribunal</title>
</svelte:head>

<div class="onboarding-page">
  <div class="onboarding-card">
    <!-- ── Brand panel ──────────────────────────────────────────────── -->
    <aside class="brand-panel" data-theme="dark">
      <div class="wordmark">
        <div class="wordmark-icon" aria-hidden="true">
          <Gavel size={18} />
        </div>
        <span class="wordmark-name">Tribunal</span>
      </div>

      <p class="brand-headline">Opinionated review on every pull request.</p>
      <p class="brand-description">
        Point AI review agents at the repositories that matter. They comment directly on GitHub —
        you stay in your workflow.
      </p>

      <Steps
        steps={onboardingSteps}
        {currentStep}
        orientation="vertical"
        label="Onboarding steps"
      />

      <p class="trust-line">
        Tribunal requests read access to code and write access to pull request comments only.
      </p>
    </aside>

    <!-- ── Repository picker panel ─────────────────────────────────── -->
    <div class="repo-panel">
      {#if connectPrompt}
        <div class="connect-empty">
          <EmptyState title={connectPrompt.title} description={connectPrompt.description}>
            {#snippet icon()}<GithubIcon size={48} />{/snippet}
            {#snippet action()}
              {#if connectPrompt.ctaHref}
                <Button href={connectPrompt.ctaHref} variant="primary" size="sm">
                  {connectPrompt.ctaLabel}
                  {#snippet leadingIcon()}<GithubIcon size={14} aria-hidden="true" />{/snippet}
                </Button>
              {:else}
                <Button variant="primary" size="sm" onclick={() => invalidateAll()}>
                  {connectPrompt.ctaLabel}
                </Button>
              {/if}
            {/snippet}
          </EmptyState>
        </div>
      {:else}
        <form method="POST" action="?/watch" use:enhance class="picker-form">
          <!--
            Hidden inputs mirror the SvelteSet selection. The checkboxes drive
            the set reactively; these inputs carry the selection to the server.
          -->
          {#each [...selectedIds] as id (id)}
            <input type="hidden" name="repositoryId" value={id} />
          {/each}

          <!--
            Surface a failed batch-watch (e.g. too many repositories selected, or
            a stale selection the user no longer owns). Without this the enhanced
            POST stays on the picker and drops the server's explanation.
          -->
          {#if form?.error}
            <p class="form-error" role="alert">{form.error}</p>
          {/if}

          <div class="picker-header">
            <div class="picker-heading-row">
              <h1 class="picker-title">Add repositories to Tribunal</h1>
              {#if accountLabel}
                <span class="account-pill">
                  <GitBranch size={14} aria-hidden="true" />
                  {accountLabel}
                </span>
              {/if}
            </div>
            <p class="picker-subtitle">
              The GitHub App can access {repoCountLabel}. Pick the ones to add to Tribunal for
              monitoring and automation. You can change this anytime.
            </p>
            <SearchField
              value={searchQuery}
              placeholder="Search {repoCountLabel}…"
              oninput={(value) => (searchQuery = value)}
            />
          </div>

          <ul class="repo-list" aria-label="Repositories">
            {#each filteredRepositories as repo (repo.id)}
              <li class="repo-row">
                <Checkbox
                  id="repo-{repo.id}"
                  checked={selectedIds.has(repo.id)}
                  fieldClass="repo-row-checkbox"
                  onValueChange={(next) => {
                    if (next) {
                      selectedIds.add(repo.id);
                    } else {
                      selectedIds.delete(repo.id);
                    }
                  }}
                />
                <!--
                  The label's for= creates explicit association with the input
                  inside Checkbox (which receives id="repo-{repo.id}"). Clicking
                  anywhere in the label — icon, name, branch badge — toggles the
                  checkbox. No label prop is passed to Checkbox to avoid nesting
                  two <label> elements.
                -->
                <label for="repo-{repo.id}" class="repo-row-label">
                  <span class="repo-icon" aria-hidden="true">
                    <FolderGit2 size={16} />
                  </span>
                  <div class="repo-identity">
                    <span class="repo-owner">{repo.owner}</span><span class="repo-separator">/</span
                    ><span class="repo-name">{repo.name}</span>
                  </div>
                  {#if repo.defaultBranch}
                    <Badge size="sm" variant="neutral">{repo.defaultBranch}</Badge>
                  {/if}
                </label>
              </li>
            {:else}
              <li class="no-results" role="status">
                {#if searchQuery.trim()}
                  No repositories matching "{searchQuery}".
                {:else}
                  No repositories found.
                {/if}
              </li>
            {/each}
          </ul>

          <div class="picker-footer">
            <span class="selection-count">
              <strong>{selectedCount}</strong>
              {selectedCount === 1 ? 'repository' : 'repositories'} selected
            </span>
            <div class="footer-actions">
              <Button href="/repositories" variant="ghost" size="md">Skip for now</Button>
              <Button type="submit" variant="primary" size="md" disabled={!canSubmit}>
                Add {selectedCount}
                {selectedCount === 1 ? 'repository' : 'repositories'}
              </Button>
            </div>
          </div>
        </form>
      {/if}
    </div>
  </div>
</div>

<style>
  /* ── Page ───────────────────────────────────────────────────────── */

  .onboarding-page {
    display: flex;
    min-height: 100vh;
    align-items: center;
    justify-content: center;
    /* Dark backdrop so the card floats above a deep navy vignette. */
    background: var(--auth-backdrop);
    padding: var(--space-6) var(--space-4);
  }

  .onboarding-card {
    display: grid;
    grid-template-columns: 340px 1fr;
    width: 100%;
    max-width: 900px;
    height: min(80vh, 760px);
    border: 1px solid var(--auth-card-border);
    border-radius: var(--radius-lg);
    overflow: hidden;
    box-shadow: var(--shadow-lg);
  }

  /* ── Brand panel ───────────────────────────────────────────────── */

  .brand-panel {
    display: flex;
    flex-direction: column;
    padding: var(--space-8) var(--space-6);
    background: var(--cinder-surface);
    border-inline-end: 1px solid var(--cinder-border);
    overflow-y: auto;
  }

  .wordmark {
    display: flex;
    align-items: center;
    gap: var(--space-2-5);
    margin-bottom: var(--space-8);
  }

  .wordmark-icon {
    width: 2rem;
    height: 2rem;
    border-radius: var(--radius-md);
    background: var(--accent);
    color: var(--accent-contrast);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .wordmark-name {
    font-size: var(--text-base);
    font-weight: var(--font-semibold);
    color: var(--cinder-text);
  }

  .brand-headline {
    font-size: var(--text-2xl);
    font-weight: var(--font-semibold);
    line-height: var(--leading-tight);
    letter-spacing: var(--tracking-tight);
    color: var(--cinder-text);
    margin: 0 0 var(--space-3);
    text-wrap: balance;
  }

  .brand-description {
    font-size: var(--text-sm);
    color: var(--cinder-text-muted);
    line-height: var(--leading-normal);
    margin: 0 0 var(--space-8);
  }

  .trust-line {
    margin-top: auto;
    font-size: var(--text-xs);
    color: var(--cinder-text-muted);
    line-height: var(--leading-normal);
  }

  /* ── Repo panel ────────────────────────────────────────────────── */

  .repo-panel {
    display: flex;
    flex-direction: column;
    background: var(--bg);
    overflow: hidden;
  }

  .connect-empty {
    display: flex;
    flex: 1;
    align-items: center;
    justify-content: center;
    padding: var(--space-8) var(--space-6);
  }

  .picker-form {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }

  /* ── Picker header ─────────────────────────────────────────────── */

  .picker-header {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-6) var(--space-6) var(--space-4);
  }

  .picker-heading-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
  }

  .picker-title {
    font-size: var(--text-lg);
    font-weight: var(--font-semibold);
    color: var(--text);
    margin: 0;
    line-height: var(--leading-tight);
  }

  .account-pill {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--text-muted);
    background: var(--cinder-surface-raised);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    padding: calc(var(--space-1) * 0.75) var(--space-2);
    white-space: nowrap;
    flex-shrink: 0;
  }

  .picker-subtitle {
    font-size: var(--text-sm);
    color: var(--text-muted);
    line-height: var(--leading-normal);
    margin: 0;
  }

  .form-error {
    margin: 0;
    padding: var(--space-3) var(--space-6);
    font-size: var(--text-sm);
    color: var(--danger);
    background: var(--danger-bg);
    border-bottom: 1px solid var(--border-muted);
  }

  /* ── Repo list ─────────────────────────────────────────────────── */

  .repo-list {
    flex: 1;
    overflow-y: auto;
    padding: 0 var(--space-6) var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    list-style: none;
    margin: 0;
  }

  .repo-row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-3-5);
    border: 1px solid var(--border-muted);
    border-radius: var(--radius-md);
    background: var(--cinder-surface-raised);
  }

  /* Let the Checkbox component sit flush in the flex row. */
  .repo-row :global(.repo-row-checkbox) {
    flex-shrink: 0;
    align-self: center;
  }

  .repo-row-label {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    flex: 1;
    min-width: 0;
    cursor: pointer;
  }

  .repo-icon {
    display: flex;
    color: var(--text-subtle);
    flex-shrink: 0;
  }

  .repo-identity {
    display: flex;
    align-items: baseline;
    min-width: 0;
    flex: 1;
    font-size: var(--text-sm);
    overflow: hidden;
  }

  .repo-owner {
    color: var(--text-muted);
    white-space: nowrap;
    flex-shrink: 0;
  }

  .repo-separator {
    color: var(--text-subtle);
    flex-shrink: 0;
  }

  .repo-name {
    font-weight: var(--font-medium);
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .no-results {
    font-size: var(--text-sm);
    color: var(--text-muted);
    padding: var(--space-4) 0;
    text-align: center;
  }

  /* ── Footer ────────────────────────────────────────────────────── */

  .picker-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    padding: var(--space-4) var(--space-6);
    border-top: 1px solid var(--border-muted);
    background: var(--cinder-surface-raised);
    flex-shrink: 0;
  }

  .selection-count {
    font-size: var(--text-sm);
    color: var(--text-muted);
  }

  .footer-actions {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  /* ── Responsive ────────────────────────────────────────────────── */

  @media (max-width: 680px) {
    .onboarding-card {
      grid-template-columns: 1fr;
      height: auto;
      max-height: none;
    }

    .brand-panel {
      border-inline-end: none;
      border-block-end: 1px solid var(--border-muted);
    }

    .picker-form {
      min-height: 60vh;
    }
  }
</style>
