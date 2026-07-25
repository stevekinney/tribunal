import { error, fail, redirect } from '@sveltejs/kit';
import { getRepositoryById } from '@tribunal/github/repositories/service';
import { githubContext } from '$lib/server/github-context';
import { userCanAccessRepository } from '$lib/server/repositories';
import {
  getRepositoryOperatorDetails,
  listAgents,
  saveRepositoryWatchSettings,
  submitRepositorySettingsForm,
} from '$lib/server/review/operator';
import type { PageServerLoad } from './$types';
import type { Actions } from './$types';

/**
 * Loads the repository settings form: ignore globs, agent assignments, and the
 * repository's watch state. Enforces the same 404-on-inaccessible-repository
 * pattern as the pull request route.
 */
export const load: PageServerLoad = async ({ params, locals }) => {
  const { user } = locals;
  if (!user) {
    redirect(302, '/login');
  }

  const repositoryId = Number(params.repositoryId);

  const repository = await getRepositoryById(githubContext, repositoryId);
  if (!repository) {
    error(404, 'Repository not found');
  }

  const canAccess = await userCanAccessRepository(user.id, repositoryId);
  if (!canAccess) {
    error(404, 'Repository not found');
  }

  const [operatorDetails, agents] = await Promise.all([
    getRepositoryOperatorDetails(user.id, [repositoryId]),
    listAgents(user.id),
  ]);

  return {
    repository: {
      id: repository.id,
      owner: repository.owner,
      name: repository.name,
      review: operatorDetails.get(repository.id) ?? {
        hasSavedSettings: false,
        watched: false,
        ignoreGlobs: [],
        agents: [],
        lastRunStatus: null,
        estimatedCostLast30DaysUsd: 0,
      },
    },
    agents,
  };
};

export const actions: Actions = {
  // SvelteKit forbids mixing a `default` action with named actions, so this
  // route uses `save`/`unwatch` rather than `default`/`unwatch`. The form's
  // `action` attribute must be updated to `?/save` to match.
  save: async ({ locals, request, params }) => {
    const { user } = locals;
    if (!user) redirect(302, '/login');

    const repositoryId = Number(params.repositoryId);
    if (!Number.isInteger(repositoryId) || repositoryId <= 0) {
      return fail(400, { error: 'Repository is invalid.' });
    }

    const canAccess = await userCanAccessRepository(user.id, repositoryId);
    if (!canAccess) {
      error(404, 'Repository not found');
    }

    const formData = await request.formData();
    return submitRepositorySettingsForm(user.id, repositoryId, formData);
  },

  /**
   * Stops watching (unwatches) this repository — the only place to do so
   * once the repositories list dropped its per-row toggle. Preserves the
   * repository's saved ignore globs and agent assignment exactly like the
   * removed table toggle did, so a later re-add restores the same
   * configuration instead of resetting to first-time defaults.
   */
  unwatch: async ({ locals, params }) => {
    const { user } = locals;
    if (!user) redirect(302, '/login');

    const repositoryId = Number(params.repositoryId);
    if (!Number.isInteger(repositoryId) || repositoryId <= 0) {
      return fail(400, { error: 'Repository is invalid.' });
    }

    const canAccess = await userCanAccessRepository(user.id, repositoryId);
    if (!canAccess) {
      error(404, 'Repository not found');
    }

    const details = (await getRepositoryOperatorDetails(user.id, [repositoryId])).get(repositoryId);
    const result = await saveRepositoryWatchSettings(user.id, {
      repositoryId,
      watched: false,
      ignoreGlobs: details?.ignoreGlobs ?? [],
      agentIds: details?.agents.map((agent) => agent.id) ?? [],
    });
    if (result && 'status' in result) return result;

    redirect(303, '/repositories');
  },
};
