import { redirect } from '@sveltejs/kit';
import { getRunsOverview, operatorSurfaceStates } from '$lib/server/review/operator';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  const { user } = locals;
  if (!user) redirect(302, '/login');

  return {
    runs: await getRunsOverview(user.id),
    surfaceStates: operatorSurfaceStates,
  };
};
