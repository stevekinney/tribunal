import { page as browserPage } from 'vitest/browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import AuthCallbackPage from './+page.svelte';

const mocks = vi.hoisted(() => ({
  svelteKitPage: {
    url: new URL(
      'http://localhost/auth/callback?returnTo=/repositories&neon_auth_session_verifier=session-verifier',
    ),
  },
  goto: vi.fn(),
  getSession: vi.fn(),
  postNeonSessionToken: vi.fn(),
}));

vi.mock('$app/state', () => ({
  page: mocks.svelteKitPage,
}));

vi.mock('$app/navigation', () => ({
  goto: mocks.goto,
}));

vi.mock('$lib/auth/neon-client', () => ({
  getNeonAuthClient: () => ({
    getSession: mocks.getSession,
  }),
  postNeonSessionToken: mocks.postNeonSessionToken,
}));

describe('/auth/callback page', () => {
  beforeEach(() => {
    mocks.svelteKitPage.url = new URL(
      'http://localhost/auth/callback?returnTo=/repositories&neon_auth_session_verifier=session-verifier',
    );
    mocks.goto.mockReset();
    mocks.getSession.mockReset();
    mocks.postNeonSessionToken.mockReset();
  });

  it('bridges the Neon JWT to SvelteKit and redirects to returnTo', async () => {
    mocks.getSession.mockResolvedValueOnce({
      data: { session: { token: 'neon-jwt' } },
      error: null,
    });
    mocks.postNeonSessionToken.mockResolvedValueOnce(undefined);

    render(AuthCallbackPage);

    await expect.element(browserPage.getByText('Completing sign in...')).toBeInTheDocument();
    await vi.waitFor(() => {
      expect(mocks.getSession).toHaveBeenCalledWith();
      expect(mocks.postNeonSessionToken).toHaveBeenCalledWith('neon-jwt');
      expect(mocks.goto).toHaveBeenCalledWith('/repositories');
    });
  });

  it('skips the "/" hop and goes straight to the resolved postLoginPath when returnTo is the default', async () => {
    mocks.svelteKitPage.url = new URL(
      'http://localhost/auth/callback?neon_auth_session_verifier=session-verifier',
    );
    mocks.getSession.mockResolvedValueOnce({
      data: { session: { token: 'neon-jwt' } },
      error: null,
    });
    mocks.fetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ postLoginPath: '/onboarding' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', mocks.fetch);

    render(AuthCallbackPage);

    await vi.waitFor(() => {
      expect(mocks.goto).toHaveBeenCalledWith('/onboarding');
    });
    expect(mocks.goto).not.toHaveBeenCalledWith('/');
  });

  it('falls back to "/" when returnTo is the default but the session bridge omits postLoginPath', async () => {
    mocks.svelteKitPage.url = new URL(
      'http://localhost/auth/callback?neon_auth_session_verifier=session-verifier',
    );
    mocks.getSession.mockResolvedValueOnce({
      data: { session: { token: 'neon-jwt' } },
      error: null,
    });
    mocks.fetch.mockResolvedValueOnce(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', mocks.fetch);

    render(AuthCallbackPage);

    await vi.waitFor(() => {
      expect(mocks.goto).toHaveBeenCalledWith('/');
    });
  });

  it('redirects to a sanitized login error when the session bridge fails', async () => {
    mocks.getSession.mockResolvedValueOnce({
      data: { session: { token: 'neon-jwt' } },
      error: null,
    });
    mocks.postNeonSessionToken.mockRejectedValueOnce(
      new Error(
        'Tribunal could not establish a Neon Auth session (status 500): {"error":{"message":"Failed query: select \\"email\\", \\"neon_auth_user_id\\" from \\"user\\""}}',
      ),
    );

    render(AuthCallbackPage);

    await vi.waitFor(() => {
      expect(mocks.goto).toHaveBeenCalledWith(
        '/login?error=neon_auth_session_failed&returnTo=%2Frepositories',
      );
    });
    expect(mocks.goto).not.toHaveBeenCalledWith(expect.stringContaining('Failed query'));
    expect(mocks.goto).not.toHaveBeenCalledWith(expect.stringContaining('neon_auth_user_id'));
  });

  it('redirects with a missing-token error when the callback URL has no session verifier', async () => {
    mocks.svelteKitPage.url = new URL('http://localhost/auth/callback?returnTo=/repositories');

    render(AuthCallbackPage);

    await vi.waitFor(() => {
      expect(mocks.getSession).not.toHaveBeenCalled();
      expect(mocks.goto).toHaveBeenCalledWith(
        '/login?error=neon_auth_token_missing&returnTo=%2Frepositories',
      );
    });
  });

  it('redirects with a missing-token error when Neon Auth returns no session token', async () => {
    mocks.getSession.mockResolvedValueOnce({
      data: { session: null },
      error: { message: 'no session' },
    });

    render(AuthCallbackPage);

    await vi.waitFor(() => {
      expect(mocks.goto).toHaveBeenCalledWith(
        '/login?error=neon_auth_token_missing&returnTo=%2Frepositories',
      );
    });
  });
});
