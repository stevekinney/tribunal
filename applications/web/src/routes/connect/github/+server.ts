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
import { getOAuthConnection } from '$lib/server/auth/authentication';
import { getUserOctokit } from '$lib/server/github/user-oauth';
import {
  getSingleInstallationConfigurationUrl,
  listUserInstallations,
} from '$lib/server/github/user-installations';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, cookies, url }) => {
  if (!locals.user) {
    redirect(302, `/login?returnTo=${encodeURIComponent(url.pathname + url.search)}`);
  }

  const connection = await getOAuthConnection(locals.user.id, 'github');
  if (!connection) {
    redirect(302, '/connect/github/account?returnTo=/connect/github');
  }

  const appName = env.GITHUB_APP_NAME;
  if (!appName) {
    throw new Error('GITHUB_APP_NAME environment variable is not set');
  }

  const octokitResult = await getUserOctokit(locals.user.id);
  let existingInstallationConfigurationUrl: string | null = null;
  if (octokitResult.ok) {
    try {
      const installations = await listUserInstallations(octokitResult.octokit);
      existingInstallationConfigurationUrl = getSingleInstallationConfigurationUrl(
        installations,
        appName,
      );
    } catch (error) {
      console.warn('Could not list GitHub installations before starting install flow', error);
    }
  }

  if (existingInstallationConfigurationUrl) {
    redirect(302, existingInstallationConfigurationUrl);
  }

  // Generate state for CSRF protection and callback binding.
  const nonce = generateState();
  const statePayload = JSON.stringify({ nonce });

  cookies.set('github_app_state', statePayload, {
    path: '/',
    httpOnly: true,
    maxAge: 60 * 10, // 10 minutes
    sameSite: 'lax',
    secure: !dev && env.E2E_TEST_MODE !== '1',
  });

  const installUrl = new URL(`https://github.com/apps/${appName}/installations/new`);
  installUrl.searchParams.set('state', nonce);

  redirect(302, installUrl.toString());
};
