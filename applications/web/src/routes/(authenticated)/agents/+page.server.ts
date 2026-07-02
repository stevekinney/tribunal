import { redirect } from '@sveltejs/kit';
import { deleteAgent, listAgents, setAgentEnabled } from '$lib/server/review/operator';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  const { user } = locals;
  if (!user) redirect(302, '/login');

  return {
    agents: await listAgents(user.id),
  };
};

export const actions: Actions = {
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
};
