import { redirect } from '@sveltejs/kit';
import {
  createOAuthState,
  setOAuthStateCookie,
  sanitizeReturnTo,
} from '$lib/server/auth/authentication';
import { getProviderClient } from '$lib/server/auth/providers';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, cookies }) => {
  const returnTo = sanitizeReturnTo(url.searchParams.get('returnTo'));
  const state = createOAuthState();

  // Store state in cookie for validation in callback
  setOAuthStateCookie(cookies, state, 'github', 'login', returnTo);

  // Request user:email scope to access private email addresses for account linking
  const github = getProviderClient('github');
  const authUrl = github.createAuthorizationURL(state, ['user:email']);

  redirect(302, authUrl.toString());
};
