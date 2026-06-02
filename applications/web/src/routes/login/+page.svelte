<script lang="ts">
  import { page } from '$app/state';
  import { Button } from '@tribunal/components/button';
  import { Alert } from '@tribunal/components/alert';
  import { LOGIN_ERROR_MESSAGES } from '$lib/constants/authorization-providers';
  import GithubIcon from 'lucide-svelte/icons/github';

  const errorParam = $derived(page.url.searchParams.get('error'));
  const errorMessage = $derived(errorParam ? LOGIN_ERROR_MESSAGES[errorParam] : null);
  const returnTo = $derived(page.url.searchParams.get('returnTo') ?? '/');

  let loading = $state(false);
</script>

<svelte:head>
  <title>Sign in - Tribunal</title>
</svelte:head>

<div class="login-page">
  <div class="login-container">
    <div class="login-header">
      <h1 class="title">Sign in to Tribunal</h1>
      <p class="description">Sign in with your GitHub account to continue</p>
    </div>

    {#if errorMessage}
      <Alert variant="danger">
        {errorMessage}
      </Alert>
    {/if}

    <div class="providers">
      <Button
        variant="secondary"
        class="provider-button"
        href="/login/github?returnTo={encodeURIComponent(returnTo)}"
        onclick={() => (loading = true)}
        disabled={loading}
      >
        <GithubIcon class="icon-md" />
        {loading ? 'Redirecting...' : 'Continue with GitHub'}
      </Button>
    </div>

    <p class="footer-text">By signing in, you agree to our Terms of Service and Privacy Policy.</p>
  </div>
</div>

<style>
  .login-page {
    display: flex;
    min-height: 100vh;
    align-items: center;
    justify-content: center;
    background: var(--surface);
    padding: var(--space-4) var(--space-6);
  }

  .login-container {
    width: 100%;
    max-width: 24rem;
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
  }

  .login-header {
    text-align: center;
  }

  .title {
    font-size: var(--text-2xl);
    font-weight: var(--font-bold);
    color: var(--text);
    letter-spacing: -0.025em;
  }

  .description {
    margin-top: var(--space-2);
    font-size: var(--text-sm);
    color: var(--text-muted);
  }

  .providers {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  :global(.provider-button) {
    width: 100%;
    justify-content: center;
    gap: var(--space-2);
  }

  .footer-text {
    text-align: center;
    font-size: var(--text-xs);
    color: var(--text-disabled);
  }
</style>
