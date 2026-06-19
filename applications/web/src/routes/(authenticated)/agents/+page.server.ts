import { redirect } from '@sveltejs/kit';
import {
  deleteAgent,
  estimateAgentDryRun,
  getReviewEffortOptions,
  getReviewModelOptions,
  getUserReviewSettings,
  listAgents,
  operatorSurfaceStates,
  saveAgent,
  setAgentEnabled,
} from '$lib/server/review/operator';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  const { user } = locals;
  if (!user) redirect(302, '/login');

  const [settings] = await getUserReviewSettings(user.id);

  return {
    agents: await listAgents(user.id),
    defaultModel: settings.defaultModel,
    modelOptions: getReviewModelOptions(),
    effortOptions: getReviewEffortOptions(),
    surfaceStates: operatorSurfaceStates,
  };
};

export const actions: Actions = {
  save: async ({ locals, request }) => {
    const { user } = locals;
    if (!user) redirect(302, '/login');

    return saveAgent(user.id, await request.formData());
  },
  setEnabled: async ({ locals, request }) => {
    const { user } = locals;
    if (!user) redirect(302, '/login');

    return setAgentEnabled(user.id, await request.formData());
  },
  delete: async ({ locals, request }) => {
    const { user } = locals;
    if (!user) redirect(302, '/login');

    return deleteAgent(user.id, await request.formData());
  },
  dryRun: async ({ locals, request }) => {
    const { user } = locals;
    if (!user) redirect(302, '/login');

    return estimateAgentDryRun(user.id, await request.formData());
  },
};
