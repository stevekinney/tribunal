<script lang="ts">
  import { page } from '$app/state';
  import { Button } from '@lostgradient/cinder/button';

  const status = $derived(page.status);
  const title = $derived(status === 404 ? 'Page Not Found' : 'Error');
  const heading = $derived(status === 404 ? 'Page Not Found' : 'Something Went Wrong');
  const message = $derived(
    status === 404
      ? 'The page you are looking for does not exist.'
      : 'An unexpected error occurred. Please try again.',
  );
</script>

<svelte:head>
  <title>{title} | Tribunal</title>
</svelte:head>

<div class="error-page">
  <div class="error-card">
    <h1 class="error-title">
      {heading}
    </h1>
    <p class="error-message">
      {message}
    </p>
    <Button href="/" variant="secondary" size="lg" label="Return Home" />
  </div>
</div>

<style>
  .error-page {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--surface);
    padding: var(--space-8);
  }

  .error-card {
    max-width: 28rem;
    background: var(--surface-raised);
    border-radius: var(--radius-lg);
    padding: var(--space-8);
    box-shadow: var(--shadow-lg);
    border: 1px solid var(--border);
    text-align: center;
  }

  .error-title {
    font-size: var(--text-2xl);
    font-weight: var(--font-bold);
    margin-bottom: var(--space-4);
    color: var(--text);
  }

  .error-message {
    color: var(--text-muted);
    margin-bottom: var(--space-6);
  }
</style>
