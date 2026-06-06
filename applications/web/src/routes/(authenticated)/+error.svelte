<script lang="ts">
  import { page } from '$app/state';
  import { Button } from '@lostgradient/cinder/button';
  import { Card } from '@lostgradient/cinder/card';
  import { ShieldAlert } from 'lucide-svelte';
  import GithubIcon from 'lucide-svelte/icons/github';

  const error = $derived(page.error);
  const status = $derived(page.status);

  // Defensive: page.error may be string, Error, or App.Error object
  const displayMessage = $derived.by(() => {
    const err = error as unknown;
    if (!err) return 'An unexpected error occurred';
    if (typeof err === 'string') return err.slice(0, 200);
    if (err instanceof Error) return err.message.slice(0, 200);
    if (
      typeof err === 'object' &&
      err !== null &&
      'message' in err &&
      typeof (err as { message: unknown }).message === 'string'
    ) {
      return (err as { message: string }).message.slice(0, 200);
    }
    return 'An unexpected error occurred';
  });

  const title = $derived(status === 404 ? 'Not Found' : 'Something went wrong');

  // Check if this is a GitHub-related error that can be resolved by connecting GitHub
  const isGitHubError = $derived.by(() => {
    const msg = displayMessage.toLowerCase();
    return (
      msg.includes('github') &&
      (msg.includes('no github') ||
        msg.includes('connect') ||
        msg.includes('installation') ||
        msg.includes('access') ||
        msg.includes('token'))
    );
  });
</script>

<div class="error-page">
  <div class="error-icon-container">
    <ShieldAlert class="error-icon" />
  </div>
  <h1 class="error-title">{title}</h1>
  <p class="error-message">
    {displayMessage}
  </p>
  <Card class="error-actions-card">
    <div class="error-actions">
      {#if isGitHubError}
        <Button href="/connect/github" variant="primary" size="sm">
          Connect GitHub
          {#snippet leadingIcon()}<GithubIcon class="icon-sm" aria-hidden="true" />{/snippet}
        </Button>
        <Button href="/repositories" variant="ghost" size="sm" label="Go to repositories" />
      {:else}
        <Button href="/repositories" variant="primary" size="sm" label="Go to repositories" />
        <Button href="/" variant="ghost" size="sm" label="Home" />
      {/if}
    </div>
  </Card>
</div>

<style>
  .error-page {
    max-width: 42rem;
    margin-inline: auto;
    padding-inline: var(--space-6);
    padding-block: var(--space-16);
    text-align: center;
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .error-icon-container {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 3rem;
    height: 3rem;
    border-radius: var(--radius-full);
    background: var(--surface-overlay);
    margin-inline: auto;
  }

  :global(.error-icon) {
    width: 1.5rem;
    height: 1.5rem;
    color: var(--warning);
  }

  .error-title {
    font-size: var(--text-2xl);
    font-weight: var(--font-semibold);
    color: var(--text);
  }

  .error-message {
    color: var(--text-subtle);
  }

  :global(.error-actions-card) {
    margin-top: var(--space-6);
  }

  .error-actions {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-3);
  }
</style>
