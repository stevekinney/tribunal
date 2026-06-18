import { redirect } from '@sveltejs/kit';
import {
  getReviewModelOptions,
  getUserReviewSettings,
  operatorSurfaceStates,
  saveUserReviewSettings,
} from '$lib/server/review/operator';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  const { user } = locals;
  if (!user) redirect(302, '/login');

  const [settings] = await getUserReviewSettings(user.id);
  return {
    settings,
    modelOptions: getReviewModelOptions(),
    surfaceStates: operatorSurfaceStates,
  };
};

export const actions: Actions = {
  save: async ({ locals, request }) => {
    const { user } = locals;
    if (!user) redirect(302, '/login');

    return saveUserReviewSettings(user.id, await request.formData());
  },
};
