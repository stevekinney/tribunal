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
  fetch: vi.fn(),
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
}));

describe('/auth/callback page', () => {
  beforeEach(() => {
    mocks.svelteKitPage.url = new URL(
      'http://localhost/auth/callback?returnTo=/repositories&neon_auth_session_verifier=session-verifier',
    );
    mocks.goto.mockReset();
    mocks.getSession.mockReset();
    mocks.fetch.mockReset();
    vi.unstubAllGlobals();
  });

  it('bridges the Neon JWT to SvelteKit and redirects to returnTo', async () => {
    mocks.getSession.mockResolvedValueOnce({
      data: { session: { token: 'neon-jwt' } },
      error: null,
    });
    mocks.fetch.mockResolvedValueOnce(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', mocks.fetch);

    render(AuthCallbackPage);

    await expect.element(browserPage.getByText('Completing sign in...')).toBeInTheDocument();
    await vi.waitFor(() => {
      expect(mocks.getSession).toHaveBeenCalledWith();
      expect(mocks.fetch).toHaveBeenCalledWith('/api/auth/neon-session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ token: 'neon-jwt' }),
      });
      expect(mocks.goto).toHaveBeenCalledWith('/repositories');
    });
  });

  it('redirects to a sanitized login error when the session bridge fails', async () => {
    mocks.getSession.mockResolvedValueOnce({
      data: { session: { token: 'neon-jwt' } },
      error: null,
    });
    mocks.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: {
            message: 'Failed query: select "email", "neon_auth_user_id" from "user"',
          },
        }),
        { status: 500 },
      ),
    );
    vi.stubGlobal('fetch', mocks.fetch);

    render(AuthCallbackPage);

    await vi.waitFor(() => {
      expect(mocks.goto).toHaveBeenCalledWith(
        '/login?error=neon_auth_session_failed&returnTo=%2Frepositories',
      );
    });
    expect(mocks.goto).not.toHaveBeenCalledWith(expect.stringContaining('Failed query'));
    expect(mocks.goto).not.toHaveBeenCalledWith(expect.stringContaining('neon_auth_user_id'));
  });
});
