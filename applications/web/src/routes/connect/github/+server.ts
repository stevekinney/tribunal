/**
 * GitHub App installation initiation handler.
 *
 * Starts the GitHub App install flow for the logged-in user. The
 * resulting installation is bound to that user in the callback.
 */
import { redirect } from '@sveltejs/kit';
import { generateState } from 'arctic';
import { env } from '$env/dynamic/private';
import { dev } from '$app/environment';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, cookies }) => {
  if (!locals.user) {
    redirect(302, '/login/github');
  }

  const appName = env.GITHUB_APP_NAME;
  if (!appName) {
    throw new Error('GITHUB_APP_NAME environment variable is not set');
  }

  // Generate state for CSRF protection and callback binding.
  const nonce = generateState();
  const statePayload = JSON.stringify({ nonce });

  // Use !dev for secure flag - url.protocol is unreliable behind reverse proxies
  cookies.set('github_app_state', statePayload, {
    path: '/',
    httpOnly: true,
    maxAge: 60 * 10, // 10 minutes
    sameSite: 'lax',
    secure: !dev,
  });

  const installUrl = new URL(`https://github.com/apps/${appName}/installations/new`);
  installUrl.searchParams.set('state', nonce);

  redirect(302, installUrl.toString());
};
