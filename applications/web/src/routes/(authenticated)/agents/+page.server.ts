import { redirect } from '@sveltejs/kit';
import {
  listAgents,
  retryReviewIntentEngineWakeup,
  setAgentEnabled,
} from '$lib/server/review/operator';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
  const { user } = locals;
  if (!user) redirect(302, '/login');

  return {
    agents: await listAgents(user.id),
    engineWakeupFailed: url.searchParams.get('engineWakeupFailed') === 'true',
  };
};

export const actions: Actions = {
  setEnabled: async ({ locals, request }) => {
    const { user } = locals;
    if (!user) redirect(302, '/login');

    return setAgentEnabled(user.id, await request.formData());
  },
  retryEngineWakeup: async ({ locals }) => {
    const { user } = locals;
    if (!user) redirect(302, '/login');

    return retryReviewIntentEngineWakeup();
  },
};
