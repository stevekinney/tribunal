<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { onMount } from 'svelte';
  import { Alert } from '@lostgradient/cinder/alert';
  import { getNeonAuthClient } from '$lib/auth/neon-client';
  import { sanitizeReturnTo } from '$lib/utilities/return-to';

  let status = $state<'loading' | 'error'>('loading');
  const returnTo = $derived(sanitizeReturnTo(page.url.searchParams.get('returnTo')));

  onMount(async () => {
    let failureCode = 'neon_auth_failed';

    try {
      const sessionVerifier = page.url.searchParams.get('neon_auth_session_verifier');
      if (!sessionVerifier) {
        failureCode = 'neon_auth_token_missing';
        throw new Error('Missing Neon Auth session verifier');
      }

      const authClient = getNeonAuthClient();
      const result = await authClient.getSession();
      const token = result?.data?.session?.token;

      if (!token) {
        failureCode = 'neon_auth_token_missing';
        const message =
          result?.error?.message ?? 'Neon Auth completed, but did not return a session token';
        console.error('Neon Auth callback did not return a session token', {
          error: result?.error,
          hasVerifier: true,
          hasSession: Boolean(result?.data?.session),
        });
        throw new Error(message);
      }

      const response = await fetch('/api/auth/neon-session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ token }),
      });

      if (!response.ok) {
        failureCode = 'neon_auth_session_failed';
        const responseBody = await response.text();
        console.error('Tribunal Neon Auth session bridge failed', {
          status: response.status,
          body: responseBody,
        });
        throw new Error('Tribunal could not establish a Neon Auth session');
      }

      await goto(returnTo);
    } catch (error) {
      console.error('Neon Auth callback failed', error);
      status = 'error';
      await goto(`/login?error=${failureCode}&returnTo=${encodeURIComponent(returnTo)}`);
    }
  });
</script>

<svelte:head>
  <title>Completing sign in - Tribunal</title>
</svelte:head>

<main class="auth-callback-page">
  {#if status === 'error'}
    <Alert variant="danger">Sign in failed. Redirecting...</Alert>
  {:else}
    <p class="status">Completing sign in...</p>
  {/if}
</main>

<style>
  .auth-callback-page {
    display: grid;
    min-height: 100vh;
    place-items: center;
    padding: var(--space-6);
    background: var(--surface);
  }

  .status {
    color: var(--text-muted);
    font-size: var(--text-sm);
  }
</style>
