<script lang="ts">
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import { getNeonAuthClient } from '$lib/auth/neon-client';

  onMount(async () => {
    try {
      const authClient = getNeonAuthClient();
      await authClient.signOut();
    } catch {
      // Continue clearing Tribunal's bridge cookie even if Neon Auth is unreachable.
    } finally {
      await fetch('/logout', {
        method: 'POST',
        credentials: 'same-origin',
      });
      await goto('/');
    }
  });
</script>

<svelte:head>
  <title>Signing out - Tribunal</title>
</svelte:head>

<main class="logout-page">
  <p>Signing out...</p>
</main>

<style>
  .logout-page {
    display: grid;
    min-height: 100vh;
    place-items: center;
    padding: var(--space-6);
    color: var(--text-muted);
  }
</style>
