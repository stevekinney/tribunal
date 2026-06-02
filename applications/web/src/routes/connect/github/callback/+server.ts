/**
 * GitHub App installation callback handler.
 *
 * Handles the redirect from GitHub after a user installs the app and
 * binds the installation to the logged-in user (with spoofing mitigation).
 */
import { error, redirect, isRedirect, isHttpError } from '@sveltejs/kit';
import { Octokit } from 'octokit';
import type { Endpoints } from '@octokit/types';
import { getGithubApplication } from '$lib/server/github/github-application';
import { upsertInstallation } from '@tribunal/github/installations/records';
import { connectInstallationToUser } from '@tribunal/github/installations/user-bindings';
import { refreshGitHubTokenIfNeeded, deleteOAuthConnection } from '$lib/server/auth/authentication';
import { githubContext } from '$lib/server/github-context';
import { isUnauthorizedError } from '@tribunal/github/errors';
import type { GitHubAccountType, RepositorySelection } from '@tribunal/database/schema';
import type { RequestHandler } from './$types';

type InstallationResponse =
  Endpoints['GET /app/installations/{installation_id}']['response']['data'];
type InstallationAccount = InstallationResponse['account'];

interface StatePayload {
  nonce: string;
}

export const GET: RequestHandler = async ({ url, cookies, locals }) => {
  if (!locals.user) {
    redirect(302, '/login/github');
  }

  // Handle user denying access on GitHub's authorization screen
  const oauthError = url.searchParams.get('error');
  if (oauthError) {
    const errorDescription =
      url.searchParams.get('error_description') || 'Authorization was cancelled';
    console.log(`GitHub App authorization denied: ${oauthError} - ${errorDescription}`);
    cookies.delete('github_app_state', { path: '/' });
    redirect(302, '/repositories?error=github_denied');
  }

  const installationId = url.searchParams.get('installation_id');
  const setupAction = url.searchParams.get('setup_action');
  const state = url.searchParams.get('state');
  const storedStateJson = cookies.get('github_app_state');

  if (!installationId) {
    error(400, 'Missing installation_id parameter');
  }

  // For updates WITHOUT state (user reconfiguring via GitHub settings directly),
  // we can't bind to a user, so just redirect to repositories.
  if (setupAction === 'update' && !storedStateJson) {
    cookies.delete('github_app_state', { path: '/' });
    redirect(302, '/repositories');
  }

  // Parse and validate state (CSRF protection)
  if (!state || !storedStateJson) {
    error(400, 'Invalid callback - missing state');
  }

  let storedState: StatePayload;
  try {
    storedState = JSON.parse(storedStateJson) as StatePayload;
  } catch {
    error(400, 'Invalid state format');
  }

  if (state !== storedState.nonce) {
    error(400, 'State mismatch - possible CSRF attempt');
  }

  const installationIdNum = Number(installationId);

  // CRITICAL: Verify user has access to this installation via their OAuth token.
  // This prevents spoofing where an attacker sends a valid installation_id they don't own.
  const userAccessToken = await refreshGitHubTokenIfNeeded(locals.user.id);
  if (!userAccessToken) {
    cookies.delete('github_app_state', { path: '/' });
    // User doesn't have GitHub linked - redirect to repositories with actionable error
    redirect(302, '/repositories?error=github_link_required');
  }

  const userOctokit = new Octokit({ auth: userAccessToken });
  try {
    const { data: userInstallations } = await userOctokit.request('GET /user/installations');
    const hasAccess = userInstallations.installations.some((i) => i.id === installationIdNum);
    if (!hasAccess) {
      error(403, 'You do not have access to this GitHub installation');
    }
  } catch (e) {
    if (isHttpError(e)) throw e;

    if (isUnauthorizedError(e)) {
      console.warn(`GitHub OAuth token invalid for user ${locals.user.id} during callback`);
      await deleteOAuthConnection(locals.user.id, 'github');
      cookies.delete('github_app_state', { path: '/' });
      redirect(302, '/repositories?error=github_token_revoked');
    }

    console.error('Failed to verify installation access:', e);
    error(403, 'Could not verify GitHub installation access');
  }

  // Fetch installation details from GitHub (using app auth, not user auth)
  const githubApp = getGithubApplication();
  if (!githubApp) {
    error(500, 'GitHub Application is not configured');
  }

  try {
    const appOctokit = await githubApp.getInstallationOctokit(installationIdNum);
    const { data: installation } = await appOctokit.rest.apps.getInstallation({
      installation_id: installationIdNum,
    });

    const account = installation.account as InstallationAccount | null;

    // Extract account info
    let accountLogin = 'unknown';
    let accountType: GitHubAccountType = 'User';

    if (account) {
      if ('login' in account && account.login) {
        accountLogin = account.login;
      } else if ('name' in account && account.name) {
        accountLogin = account.name;
      }

      if ('type' in account && account.type) {
        accountType = account.type as GitHubAccountType;
      }
    }

    // Create or update the installation record, bound to this user.
    await upsertInstallation(githubContext, {
      installationId: installation.id,
      accountLogin,
      accountType,
      accountId: account?.id ?? 0,
      accountAvatarUrl: account?.avatar_url,
      repositorySelection: (installation.repository_selection ?? 'selected') as RepositorySelection,
      userId: locals.user.id,
    });

    // Ensure the binding is set even if the record already existed.
    await connectInstallationToUser(githubContext, {
      userId: locals.user.id,
      installationId: installation.id,
    });

    // NOTE: This is where the app would enqueue an installation sync workflow
    // to fetch repositories. Workflow dispatch is not wired up in this build.
    console.log(
      `[connect] Installation ${installation.id} bound to user ${locals.user.id}; would enqueue repository sync here.`,
    );

    cookies.delete('github_app_state', { path: '/' });

    redirect(302, '/repositories?github=connected');
  } catch (e) {
    // Re-throw SvelteKit's redirect and error objects
    if (isRedirect(e) || isHttpError(e)) {
      throw e;
    }
    console.error('GitHub Application installation callback error:', e);
    error(400, 'Failed to complete GitHub Application installation');
  }

  redirect(302, '/repositories');
};
