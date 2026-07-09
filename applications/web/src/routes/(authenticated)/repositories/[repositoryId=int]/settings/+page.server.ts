import { error, fail, redirect } from '@sveltejs/kit';
import { getRepositoryById } from '@tribunal/github/repositories/service';
import { githubContext } from '$lib/server/github-context';
import { userCanAccessRepository } from '$lib/server/repositories';
import {
  getRepositoryOperatorDetails,
  listAgents,
  saveRepositoryWatchSettings,
} from '$lib/server/review/operator';
import type { PageServerLoad } from './$types';
import type { Actions } from './$types';

/**
 * Normalizes submitted ignore globs: trims whitespace, drops empty values, and
 * removes duplicates while preserving the first occurrence's order.
 */
function normalizeIgnoreGlobs(values: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed.length === 0) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    normalized.push(trimmed);
  }

  return normalized;
}

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
  default: async ({ locals, request, params }) => {
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
    const submittedAgentIds = formData.getAll('agentIds').map(String);
    const submittedIgnoreGlobs = normalizeIgnoreGlobs(formData.getAll('ignoreGlobs').map(String));

    return saveRepositoryWatchSettings(user.id, {
      repositoryId,
      watched: true,
      ignoreGlobs: submittedIgnoreGlobs,
      agentIds: submittedAgentIds,
    });
  },
};
