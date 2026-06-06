import { redirect } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import {
  createOAuthState,
  sanitizeReturnTo,
  setOAuthStateCookie,
} from '$lib/server/auth/authentication';
import { getGithubRedirectUri, getProviderClient } from '$lib/server/auth/providers';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, url, cookies }) => {
  const returnTo = sanitizeReturnTo(url.searchParams.get('returnTo') ?? '/repositories');

  if (!locals.user) {
    redirect(302, `/login?returnTo=${encodeURIComponent(url.pathname + url.search)}`);
  }

  if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) {
    redirect(
      302,
      `/repositories?error=github_oauth_not_configured&returnTo=${encodeURIComponent(returnTo)}`,
    );
  }

  if (!getGithubRedirectUri()) {
    redirect(
      302,
      `/repositories?error=github_redirect_uri_not_configured&returnTo=${encodeURIComponent(returnTo)}`,
    );
  }

  const state = createOAuthState();
  setOAuthStateCookie(cookies, state, 'github', returnTo, locals.user.id);

  const github = getProviderClient('github');
  const authUrl = github.createAuthorizationURL(state, ['repo', 'user:email']);

  redirect(302, authUrl.toString());
};
