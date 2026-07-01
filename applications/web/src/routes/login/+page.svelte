<script lang="ts">
  import { page } from '$app/state';
  import { Button } from '@lostgradient/cinder/button';
  import { Alert } from '@lostgradient/cinder/alert';
  import { LOGIN_ERROR_MESSAGES } from '$lib/constants/authorization-providers';
  import { startGithubSignIn } from '$lib/auth/start-github-sign-in';
  import { sanitizeReturnTo } from '$lib/utilities/return-to';
  import GithubIcon from 'lucide-svelte/icons/github';
  import Gavel from 'lucide-svelte/icons/gavel';

  const errorParam = $derived(page.url.searchParams.get('error'));
  const errorMessage = $derived(errorParam ? LOGIN_ERROR_MESSAGES[errorParam] : null);
  // User cancellations (*_denied) are informational, not failures.
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

<svelte:head>
  <title>Sign in - Tribunal</title>
</svelte:head>

<div class="login-page">
  <div class="login-card">
    <!-- Dark brand panel — always rendered with dark theme tokens -->
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

      <ol class="steps" aria-label="Onboarding steps">
        <li class="step step-current" aria-current="step">
          <span class="step-marker step-marker-current" aria-hidden="true">1</span>
          <span class="step-label step-label-current">Sign in with GitHub</span>
        </li>
        <li class="step">
          <span class="step-marker" aria-hidden="true">2</span>
          <span class="step-label">Install the GitHub App</span>
        </li>
        <li class="step">
          <span class="step-marker" aria-hidden="true">3</span>
          <span class="step-label">Choose repositories to watch</span>
        </li>
      </ol>

      <p class="trust-line">
        Tribunal requests read access to code and write access to pull request comments only.
      </p>
    </aside>

    <!-- Sign-in panel — follows the user's active color scheme -->
    <div class="signin-panel">
      <div class="signin-content">
        <div class="signin-header">
          <h1 class="signin-title">Sign in to Tribunal</h1>
          <p class="signin-description">Connect your GitHub account to get started.</p>
        </div>

        {#if errorMessage}
          <Alert variant={errorVariant}>
            {errorMessage}
          </Alert>
        {/if}

        <Button variant="primary" size="md" fullWidth onclick={onSignIn} {loading}>
          {loading ? 'Redirecting...' : 'Continue with GitHub'}
          {#snippet leadingIcon()}<GithubIcon width="20" height="20" aria-hidden="true" />{/snippet}
        </Button>

        <p class="privacy-note">
          By signing in, you agree to our Terms of Service and Privacy Policy.
        </p>
      </div>
    </div>
  </div>
</div>

<style>
  .login-page {
    display: flex;
    min-height: 100vh;
    align-items: center;
    justify-content: center;
    /* Dark backdrop so the card floats above a deep navy vignette. */
    background: var(--auth-backdrop);
    padding: var(--space-6) var(--space-4);
  }

  .login-card {
    display: grid;
    grid-template-columns: 320px 1fr;
    width: 100%;
    max-width: 760px;
    border: 1px solid var(--auth-card-border);
    border-radius: var(--radius-lg);
    overflow: hidden;
    box-shadow: var(--shadow-lg);
  }

  /* ---- Brand panel ---- */

  /*
   * light-dark() tokens are resolved at :root (color-scheme: light) and do NOT
   * re-evaluate under a data-theme="dark" subtree — verified app-wide (the
   * authenticated sidebar applies the same workaround). Without these explicit
   * dark-arm overrides the panel renders light. Pin the tokens it consumes.
   */
  .brand-panel[data-theme='dark'] {
    --surface: oklch(20% 0.04 245);
    --text: oklch(92% 0.02 245);
    --text-muted: oklch(82% 0.02 245);
    --text-subtle: oklch(72% 0.02 245);
    --border-muted: oklch(30% 0.04 245);
  }

  .brand-panel {
    display: flex;
    flex-direction: column;
    padding: var(--space-8) var(--space-6);
    background: var(--surface);
    border-inline-end: 1px solid var(--border-muted);
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
    color: var(--text);
  }

  .brand-headline {
    font-size: var(--text-2xl);
    font-weight: var(--font-semibold);
    line-height: var(--leading-tight);
    letter-spacing: var(--tracking-tight);
    color: var(--text);
    margin: 0 0 var(--space-3);
    text-wrap: balance;
  }

  .brand-description {
    font-size: var(--text-sm);
    color: var(--text-muted);
    line-height: var(--leading-normal);
    margin: 0 0 var(--space-8);
  }

  /* ---- Onboarding steps ---- */

  .steps {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .step {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  .step-marker {
    width: 1.5rem;
    height: 1.5rem;
    border-radius: var(--radius-full);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    border: 1px solid var(--border-muted);
    color: var(--text-subtle);
    background: transparent;
  }

  .step-marker-current {
    background: var(--accent);
    color: var(--accent-contrast);
    border-color: transparent;
  }

  .step-label {
    font-size: var(--text-sm);
    color: var(--text-muted);
  }

  .step-label-current {
    color: var(--text);
    font-weight: var(--font-medium);
  }

  .trust-line {
    margin-top: auto;
    font-size: var(--text-xs);
    color: var(--text-subtle);
    line-height: var(--leading-normal);
  }

  /* ---- Sign-in panel ---- */

  .signin-panel {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-8) var(--space-6);
    background: var(--surface);
  }

  .signin-content {
    width: 100%;
    max-width: 20rem;
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
  }

  .signin-header {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .signin-title {
    font-size: var(--text-xl);
    font-weight: var(--font-semibold);
    color: var(--text);
    margin: 0;
    letter-spacing: 0;
  }

  .signin-description {
    font-size: var(--text-sm);
    color: var(--text-muted);
    margin: 0;
  }

  .privacy-note {
    font-size: var(--text-xs);
    color: var(--text-disabled);
    text-align: center;
    margin: 0;
  }

  /* ---- Responsive ---- */

  @media (max-width: 600px) {
    .login-card {
      grid-template-columns: 1fr;
    }

    .brand-panel {
      border-inline-end: none;
      border-block-end: 1px solid var(--border-muted);
    }
  }
</style>
