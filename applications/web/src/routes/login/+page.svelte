<script lang="ts">
  import { page } from '$app/state';
  import { Button } from '@lostgradient/cinder/button';
  import { Alert } from '@lostgradient/cinder/alert';
  import { LOGIN_ERROR_MESSAGES } from '$lib/constants/authorization-providers';
  import { getNeonAuthClient } from '$lib/auth/neon-client';
  import { sanitizeReturnTo } from '$lib/utilities/return-to';
  import GithubIcon from 'lucide-svelte/icons/github';

  const errorParam = $derived(page.url.searchParams.get('error'));
  const errorMessage = $derived(errorParam ? LOGIN_ERROR_MESSAGES[errorParam] : null);
  const returnTo = $derived(sanitizeReturnTo(page.url.searchParams.get('returnTo')));

  let loading = $state(false);

  async function startGithubSignIn() {
    loading = true;

    try {
      if (!page.data.neonAuthConfigured) {
        window.location.href = `/login?error=neon_auth_not_configured&returnTo=${encodeURIComponent(returnTo)}`;
        return;
      }

      const callbackUrl = new URL('/auth/callback', window.location.origin);
      callbackUrl.searchParams.set('returnTo', returnTo);
      const errorCallbackUrl = new URL('/login', window.location.origin);
      errorCallbackUrl.searchParams.set('error', 'neon_auth_failed');
      errorCallbackUrl.searchParams.set('returnTo', returnTo);

      const authClient = getNeonAuthClient();
      const result = await authClient.signIn.social({
        provider: 'github',
        callbackURL: callbackUrl.toString(),
        newUserCallbackURL: callbackUrl.toString(),
        errorCallbackURL: errorCallbackUrl.toString(),
        disableRedirect: true,
      });

      if (!result.data?.url) {
        throw new Error('Neon Auth did not return a GitHub OAuth URL');
      }

      window.location.href = result.data.url;
    } catch (error) {
      console.error('Neon Auth GitHub sign-in failed to start', error);
      loading = false;
      window.location.href = `/login?error=neon_auth_failed&returnTo=${encodeURIComponent(returnTo)}`;
    }
  }
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
      <Alert variant="error">
        {errorMessage}
      </Alert>
    {/if}

    <div class="providers">
      <Button
        variant="secondary"
        size="sm"
        class="provider-button"
        onclick={startGithubSignIn}
        disabled={loading}
      >
        {loading ? 'Redirecting...' : 'Continue with GitHub'}
        {#snippet leadingIcon()}<GithubIcon width="20" height="20" aria-hidden="true" />{/snippet}
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
    letter-spacing: 0;
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
