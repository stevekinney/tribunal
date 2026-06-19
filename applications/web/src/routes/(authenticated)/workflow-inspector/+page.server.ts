import { env } from '$env/dynamic/private';
import { redirect } from '@sveltejs/kit';
import { getRunsOverview, operatorSurfaceStates } from '$lib/server/review/operator';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  const { user } = locals;
  if (!user) redirect(302, '/login');

  const enabled = env.WEFT_INSPECTOR === '1' && user.isPlatformAdministrator;
  return {
    enabled,
    runs: enabled ? await getRunsOverview(user.id) : [],
    surfaceStates: operatorSurfaceStates,
  };
};
