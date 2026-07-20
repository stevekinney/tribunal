<script lang="ts">
  import { page } from '$app/state';
  import { Cat } from 'lucide-svelte';
  import GithubIcon from 'lucide-svelte/icons/github';
  import { Button } from '@lostgradient/cinder/button';
  import { Alert } from '@lostgradient/cinder/alert';
  import { LOGIN_ERROR_MESSAGES } from '$lib/constants/authorization-providers';
  import { startGithubSignIn } from '$lib/auth/start-github-sign-in';
  import { sanitizeReturnTo } from '$lib/utilities/return-to';

  const errorParam = $derived(page.url.searchParams.get('error'));
  const errorMessage = $derived(errorParam ? LOGIN_ERROR_MESSAGES[errorParam] : null);
  // User cancellations (*_denied) should be info, actual errors should be danger
  const errorVariant = $derived(errorParam?.endsWith('_denied') ? 'info' : 'danger');
  const returnTo = $derived(sanitizeReturnTo(page.url.searchParams.get('returnTo')));

  let loading = $state(false);

  async function onSignIn() {
    loading = true;
    try {
      await startGithubSignIn({ neonAuthConfigured: page.data.neonAuthConfigured, returnTo });
    } catch {
      // startGithubSignIn already redirected to /login with an error code and
      // logged the cause; restore the button while that navigation settles.
      loading = false;
    }
  }
</script>

<main class="landing-page" data-theme="dark">
  <div class="landing-content">
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
      <Button variant="primary" size="lg" onclick={onSignIn} {loading}>
        {loading ? 'Redirecting...' : 'Sign in with GitHub'}
        {#snippet leadingIcon()}<GithubIcon aria-hidden="true" />{/snippet}
      </Button>
    </div>
  </div>
</main>

<style>
  .landing-page {
    display: flex;
    min-height: 100vh;
    align-items: center;
    justify-content: center;
    padding: var(--space-6) var(--space-4);
    background: var(--auth-backdrop);
  }

  .landing-content {
    max-width: 28rem;
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
    background: var(--surface-raised);
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
