import { redirect } from '@sveltejs/kit';
import {
  getReviewEffortOptions,
  getReviewModelOptions,
  listAgents,
  operatorSurfaceStates,
  saveAgent,
} from '$lib/server/review/operator';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  const { user } = locals;
  if (!user) redirect(302, '/login');

  return {
    agents: await listAgents(user.id),
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
};
