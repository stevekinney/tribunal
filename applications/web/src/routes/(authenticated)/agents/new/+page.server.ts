import { redirect } from '@sveltejs/kit';
import {
  getReviewEffortOptions,
  getReviewModelOptions,
  getUserReviewSettings,
  saveAgent,
} from '$lib/server/review/operator';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  const { user } = locals;
  if (!user) redirect(302, '/login');

  const [settings] = await getUserReviewSettings(user.id);

  return {
    defaultModel: settings.defaultModel === 'inherit' ? 'sonnet' : settings.defaultModel,
    modelOptions: getReviewModelOptions(),
    effortOptions: getReviewEffortOptions(),
  };
};

export const actions: Actions = {
  save: async ({ locals, request }) => {
    const { user } = locals;
    if (!user) redirect(302, '/login');

    const result = await saveAgent(user.id, await request.formData());
    if ('status' in result) return result;

    redirect(303, `/agents/${result.id}`);
  },
};
