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

const keepGithubRedirectPending = () => {
  mocks.signInSocial.mockReturnValueOnce(new Promise(() => {}));
};

describe('/ welcome page', () => {
  beforeEach(() => {
    mocks.svelteKitPage.data = { neonAuthConfigured: true };
    mocks.svelteKitPage.url = new URL('http://localhost/');
    mocks.signInSocial.mockReset();
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
});
