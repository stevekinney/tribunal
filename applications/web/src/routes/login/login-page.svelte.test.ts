import { page as browserPage } from 'vitest/browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import LoginPage from './+page.svelte';

const mocks = vi.hoisted(() => ({
  svelteKitPage: {
    data: { neonAuthConfigured: true },
    url: new URL('http://localhost/login?returnTo=/repositories'),
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
// Delegate to the real implementation by default (so the other assertions on
// signInSocial's arguments still exercise real code), but allow a single
// test to override it with a rejection that never navigates.
vi.mock('$lib/auth/start-github-sign-in', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/auth/start-github-sign-in')>();
  mocks.startGithubSignIn.mockImplementation(actual.startGithubSignIn);
  return { startGithubSignIn: mocks.startGithubSignIn };
});

const keepGithubRedirectPending = () => {
  mocks.signInSocial.mockReturnValueOnce(new Promise(() => {}));
};

describe('/login page', () => {
  beforeEach(() => {
    mocks.svelteKitPage.data = { neonAuthConfigured: true };
    mocks.svelteKitPage.url = new URL('http://localhost/login?returnTo=/repositories');
    mocks.signInSocial.mockReset();
    mocks.startGithubSignIn.mockClear();
  });

  it('starts Neon Auth GitHub sign-in with a sanitized callback URL', async () => {
    keepGithubRedirectPending();

    render(LoginPage);

    await browserPage.getByRole('button', { name: 'Continue with GitHub' }).click();

    expect(mocks.signInSocial).toHaveBeenCalledTimes(1);
    const [signInOptions] = mocks.signInSocial.mock.calls[0];
    expect(signInOptions.provider).toBe('github');
    expect(signInOptions.disableRedirect).toBe(true);
    const callbackUrl = new URL(signInOptions.callbackURL, mocks.svelteKitPage.url.origin);
    const expectedCallbackUrl = new URL('/auth/callback', window.location.origin);
    expectedCallbackUrl.searchParams.set('returnTo', '/repositories');
    const expectedErrorCallbackUrl = new URL('/login', window.location.origin);
    expectedErrorCallbackUrl.searchParams.set('error', 'neon_auth_failed');
    expectedErrorCallbackUrl.searchParams.set('returnTo', '/repositories');
    expect(signInOptions.callbackURL).toBe(expectedCallbackUrl.toString());
    expect(signInOptions.newUserCallbackURL).toBe(signInOptions.callbackURL);
    expect(signInOptions.errorCallbackURL).toBe(expectedErrorCallbackUrl.toString());
    expect(callbackUrl.pathname).toBe('/auth/callback');
    expect(callbackUrl.searchParams.get('returnTo')).toBe('/repositories');
    await expect
      .element(browserPage.getByRole('button', { name: 'Redirecting...' }))
      .toBeInTheDocument();
  });

  it('restarts GitHub connection flow instead of returning to a stale OAuth callback', async () => {
    mocks.svelteKitPage.url = new URL(
      'http://localhost/login?returnTo=/connect/github/account/callback?code=oauth-code&state=oauth-state',
    );
    keepGithubRedirectPending();

    render(LoginPage);

    await browserPage.getByRole('button', { name: 'Continue with GitHub' }).click();

    const [signInOptions] = mocks.signInSocial.mock.calls[0];
    const callbackUrl = new URL(signInOptions.callbackURL, mocks.svelteKitPage.url.origin);
    expect(callbackUrl.searchParams.get('returnTo')).toBe('/connect/github');
    expect(signInOptions.errorCallbackURL).toContain('returnTo=%2Fconnect%2Fgithub');
  });

  it('ignores raw detail query parameters in rendered errors', async () => {
    mocks.svelteKitPage.url = new URL(
      'http://localhost/login?error=neon_auth_session_failed&detail=Failed%20query%3A%20select%20secret',
    );

    render(LoginPage);

    expect(document.body.textContent).toContain(
      'Neon Auth completed, but Tribunal could not create a local session. Check the development server logs.',
    );
    expect(document.body.textContent).not.toContain('Failed query');
    expect(document.body.textContent).not.toContain('select secret');
  });

  it('restores the button when starting GitHub sign-in fails', async () => {
    // Reject via the wrapper directly (rather than signInSocial) so this
    // never reaches the real implementation's `window.location.href`
    // navigation, which would tear down the test's browser session.
    mocks.startGithubSignIn.mockRejectedValueOnce(new Error('network down'));

    render(LoginPage);

    await browserPage.getByRole('button', { name: 'Continue with GitHub' }).click();

    await expect
      .element(browserPage.getByRole('button', { name: 'Continue with GitHub' }))
      .toBeInTheDocument();
  });
});
