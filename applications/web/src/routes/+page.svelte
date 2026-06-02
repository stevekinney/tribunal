<script lang="ts">
  import { page } from '$app/state';
  import { Cat } from 'lucide-svelte';
  import GithubIcon from 'lucide-svelte/icons/github';
  import { Button } from '@tribunal/components/button';
  import { Alert } from '@tribunal/components/alert';
  import { LOGIN_ERROR_MESSAGES } from '$lib/constants/authorization-providers';

  const errorParam = $derived(page.url.searchParams.get('error'));
  const errorMessage = $derived(errorParam ? LOGIN_ERROR_MESSAGES[errorParam] : null);
  // User cancellations (*_denied) should be info, actual errors should be danger
  const errorVariant = $derived(errorParam?.endsWith('_denied') ? 'info' : 'danger');
</script>

<main class="landing-page">
  {#if errorMessage}
    <Alert variant={errorVariant} class="alert-left">
      {errorMessage}
    </Alert>
  {/if}
  <div class="logo-container">
    <Cat class="logo-icon" />
  </div>
  <h1 class="title">Welcome to Tribunal</h1>
  <div class="actions">
    <Button href="/login/github" variant="secondary" size="lg" icon={GithubIcon}>
      Sign in with GitHub
    </Button>
  </div>
</main>

<style>
  .landing-page {
    max-width: 48rem;
    margin-inline: auto;
    padding-inline: var(--space-6);
    padding-block: var(--space-16);
    text-align: center;
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
  }

  :global(.alert-left) {
    text-align: left;
  }

  .logo-container {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 3.5rem;
    height: 3.5rem;
    border-radius: var(--radius-full);
    background: var(--surface-overlay);
    margin-inline: auto;
  }

  :global(.logo-icon) {
    width: 1.75rem;
    height: 1.75rem;
    color: var(--accent);
  }

  .title {
    font-size: var(--text-3xl);
    font-weight: var(--font-semibold);
    color: var(--text);
  }

  .actions {
    display: flex;
    justify-content: center;
    gap: var(--space-3);
  }
</style>
