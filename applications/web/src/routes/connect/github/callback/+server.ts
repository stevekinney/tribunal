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
import { refreshInstallationRepositories } from '@tribunal/github/repositories/service';
import { refreshGitHubTokenIfNeeded, deleteOAuthConnection } from '$lib/server/auth/authentication';
import { githubContext } from '$lib/server/github-context';
import { isUnauthorizedError } from '@tribunal/github/errors';
import {
  listUserInstallations,
  userHasInstallationAccess,
} from '$lib/server/github/user-installations';
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
    redirect(302, `/login?returnTo=${encodeURIComponent('/connect/github')}`);
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

  const isUpdateWithoutState = setupAction === 'update' && !storedStateJson;

  // Parse and validate state (CSRF protection). GitHub does not include our
  // state when a user edits repository access from an existing installation's
  // settings page, so that update path is validated through live installation
  // access below instead.
  if (!isUpdateWithoutState) {
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
  }

  const installationIdNum = Number(installationId);

  // CRITICAL: Verify user has access to this installation via their OAuth token.
  // This prevents spoofing where an attacker sends a valid installation_id they don't own.
  const userAccessToken = await refreshGitHubTokenIfNeeded(locals.user.id);
  if (!userAccessToken) {
    cookies.delete('github_app_state', { path: '/' });
    redirect(302, '/connect/github/account?returnTo=/connect/github');
  }

  const userOctokit = new Octokit({ auth: userAccessToken });
  try {
    const userInstallations = await listUserInstallations(userOctokit);
    if (!userHasInstallationAccess(userInstallations, installationIdNum)) {
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

    let repositoryRefreshFailed = false;
    try {
      // Direct (synchronous) refresh is intentional here: the user just completed
      // the GitHub install/connect flow and expects to see their repositories
      // immediately. The durable `installation-sync` Weft workflow handles the
      // ongoing, coalesced path from lifecycle webhooks; both call this same
      // shared body (refreshInstallationRepositories). See its JSDoc.
      const refreshResult = await refreshInstallationRepositories(githubContext, installation.id);
      console.log(
        `[connect] Installation ${installation.id} bound to user ${locals.user.id}; refreshed ${refreshResult.repositoryCount} repositories.`,
      );
    } catch (refreshError) {
      repositoryRefreshFailed = true;
      console.error(
        `[connect] Installation ${installation.id} was bound to user ${locals.user.id}, but repository refresh failed.`,
        refreshError,
      );
    }

    cookies.delete('github_app_state', { path: '/' });

    redirect(
      302,
      repositoryRefreshFailed
        ? '/repositories?github=connected&error=github_installation_refresh_failed'
        : '/repositories?github=connected',
    );
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
