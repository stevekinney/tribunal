import { fail, redirect } from '@sveltejs/kit';
import { getRepositoriesForUser } from '$lib/server/repositories';
import {
  getRepositoryOperatorDetails,
  listAgents,
  operatorSurfaceStates,
  parseIgnoreGlobs,
  saveRepositoryWatchSettings,
} from '$lib/server/review/operator';
import type { PageServerLoad } from './$types';
import type { Actions } from './$types';

const repositoryPageErrorMessages: Partial<Record<string, string>> = {
  github_denied: 'GitHub authorization was cancelled. Try again when you are ready.',
  github_failed: 'GitHub authorization failed. Please try again.',
  github_installation_refresh_failed:
    'GitHub App was connected, but Tribunal could not refresh repositories. Try again from Manage repository access.',
  github_oauth_not_configured:
    'GitHub OAuth is not configured. Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET, then restart the development server.',
  github_redirect_uri_not_configured:
    'GitHub OAuth redirect URI is not configured. Set GITHUB_REDIRECT_URI outside local development.',
  github_token_revoked: 'GitHub access was revoked. Reconnect your GitHub account to continue.',
};

/**
 * Lists the repositories the logged-in user can reach through their GitHub App
 * installations. When the user has no GitHub connection at all we surface a
 * connect prompt rather than erroring out.
 */
export const load: PageServerLoad = async ({ locals, url }) => {
  const { user } = locals;
  if (!user) {
    redirect(302, '/login');
  }

  const routeError = repositoryPageErrorMessages[url.searchParams.get('error') ?? ''] ?? null;
  const result = await getRepositoriesForUser(user.id);

  if (!result.ok) {
    if (result.error === 'no_github_token' && !routeError) {
      redirect(
        302,
        `/connect/github/account?returnTo=${encodeURIComponent(url.pathname + url.search)}`,
      );
    }

    // No usable GitHub token, or GitHub was unreachable. Render the page with a
    // connect prompt instead of a hard error so the user has an obvious next step.
    return {
      repositories: [],
      agents: [],
      installations: [],
      needsConnect: result.error === 'no_github_token',
      loadError: routeError ?? (result.error === 'github_unavailable' ? result.message : null),
      surfaceStates: operatorSurfaceStates,
    };
  }

  const repositoryIds = result.repositories.map((entry) => entry.repository.id);
  const [operatorDetails, agents] = await Promise.all([
    getRepositoryOperatorDetails(user.id, repositoryIds),
    listAgents(user.id),
  ]);

  return {
    repositories: result.repositories.map((entry) => ({
      id: entry.repository.id,
      owner: entry.repository.owner,
      name: entry.repository.name,
      defaultBranch: entry.repository.defaultBranch,
      accountLogin: entry.installation.accountLogin,
      accountAvatarUrl: entry.installation.accountAvatarUrl,
      review: operatorDetails.get(entry.repository.id) ?? {
        hasSavedSettings: false,
        watched: false,
        ignoreGlobs: [],
        agents: [],
        lastRunStatus: null,
        estimatedCostLast30DaysUsd: 0,
      },
    })),
    agents,
    installations: result.installations,
    needsConnect: false,
    loadError: routeError,
    surfaceStates: operatorSurfaceStates,
  };
};

export const actions: Actions = {
  watch: async ({ locals, request }) => {
    const { user } = locals;
    if (!user) redirect(302, '/login');

    const formData = await request.formData();
    const repositoryId = Number(formData.get('repositoryId'));
    if (!Number.isInteger(repositoryId) || repositoryId <= 0) {
      return fail(400, { error: 'Repository is invalid.' });
    }

    return saveRepositoryWatchSettings(user.id, {
      repositoryId,
      watched: formData.get('watched') === 'on',
      ignoreGlobs: parseIgnoreGlobs(String(formData.get('ignoreGlobs') ?? '')),
      agentIds: formData.getAll('agentIds').map(String),
    });
  },
};
