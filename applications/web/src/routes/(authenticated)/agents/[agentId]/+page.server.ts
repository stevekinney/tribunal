import { error, redirect } from '@sveltejs/kit';
import {
  getAgent,
  getReviewEffortOptions,
  getReviewModelOptions,
  getUserReviewSettings,
  saveAgent,
} from '$lib/server/review/operator';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
  const { user } = locals;
  if (!user) redirect(302, '/login');

  const [agent, [settings]] = await Promise.all([
    getAgent(user.id, params.agentId),
    getUserReviewSettings(user.id),
  ]);
  if (!agent) error(404, 'Agent not found.');

  return {
    agent,
    defaultModel: settings.defaultModel === 'inherit' ? 'sonnet' : settings.defaultModel,
    modelOptions: getReviewModelOptions(),
    effortOptions: getReviewEffortOptions(),
  };
};

export const actions: Actions = {
  save: async ({ locals, request }) => {
    const { user } = locals;
    if (!user) redirect(302, '/login');

    return saveAgent(user.id, await request.formData());
  },
};
