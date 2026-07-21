import { page as browserPage } from 'vitest/browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import LandingPage from './+page.svelte';

const mocks = vi.hoisted(() => ({
  svelteKitPage: {
    data: { neonAuthConfigured: true },
    url: new URL('http://localhost/'),
  },
  signInSocial: vi.fn(),
  startGithubSignIn: vi.fn(),
}));

vi.mock('$app/state', () => ({
  page: mocks.svelteKitPage,
}));

vi.mock('$lib/auth/neon-client', () => ({
  getNeonAuthClient: () => ({
    signIn: {
      social: mocks.signInSocial,
    },
  }),
}));

// The real startGithubSignIn always ends by navigating the browser for real
// (window.location.href = ...), which would tear down this test's iframe.
// Delegate to the real implementation by default (so the happy-path
// assertions on signInSocial's arguments still exercise real code), but
// allow a single test to override it with a rejection that never navigates.
vi.mock('$lib/auth/start-github-sign-in', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/auth/start-github-sign-in')>();
  mocks.startGithubSignIn.mockImplementation(actual.startGithubSignIn);
  return { startGithubSignIn: mocks.startGithubSignIn };
});

const keepGithubRedirectPending = () => {
  mocks.signInSocial.mockReturnValueOnce(new Promise(() => {}));
};

describe('/ welcome page', () => {
  beforeEach(() => {
    mocks.svelteKitPage.data = { neonAuthConfigured: true };
    mocks.svelteKitPage.url = new URL('http://localhost/');
    mocks.signInSocial.mockReset();
    mocks.startGithubSignIn.mockClear();
  });

  it('starts GitHub sign-in directly instead of routing through /login', async () => {
    keepGithubRedirectPending();

    render(LandingPage);

    await browserPage.getByRole('button', { name: 'Sign in with GitHub' }).click();

    expect(mocks.signInSocial).toHaveBeenCalledTimes(1);
    const [signInOptions] = mocks.signInSocial.mock.calls[0];
    expect(signInOptions.provider).toBe('github');
    expect(signInOptions.disableRedirect).toBe(true);
    // No returnTo on the URL → default '/', which the server load then bounces to
    // the right authenticated landing.
    const callbackUrl = new URL(signInOptions.callbackURL, window.location.origin);
    expect(callbackUrl.pathname).toBe('/auth/callback');
    expect(callbackUrl.searchParams.get('returnTo')).toBe('/');
    await expect
      .element(browserPage.getByRole('button', { name: 'Redirecting...' }))
      .toBeInTheDocument();
  });

  it('shows a danger alert for a non-denial error code', async () => {
    mocks.svelteKitPage.url = new URL('http://localhost/?error=github_failed');

    render(LandingPage);

    const alert = browserPage.getByText('GitHub authentication failed. Please try again.');
    await expect.element(alert).toBeVisible();
  });

  it('shows an info alert when the user cancelled sign-in', async () => {
    mocks.svelteKitPage.url = new URL('http://localhost/?error=github_denied');

    render(LandingPage);

    await expect
      .element(
        browserPage.getByText(
          "You cancelled the sign in. Click a button below when you're ready to try again.",
        ),
      )
      .toBeVisible();
  });

  it('restores the button when starting GitHub sign-in fails', async () => {
    // Reject via the wrapper directly (rather than signInSocial) so this
    // never reaches the real implementation's `window.location.href`
    // navigation, which would tear down the test's browser session.
    mocks.startGithubSignIn.mockRejectedValueOnce(new Error('network down'));

    render(LandingPage);

    await browserPage.getByRole('button', { name: 'Sign in with GitHub' }).click();

    await expect
      .element(browserPage.getByRole('button', { name: 'Sign in with GitHub' }))
      .toBeInTheDocument();
  });
});
