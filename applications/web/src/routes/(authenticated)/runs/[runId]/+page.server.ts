import { redirect } from '@sveltejs/kit';
import { getRunInspector, operatorSurfaceStates } from '$lib/server/review/operator';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
  const { user } = locals;
  if (!user) redirect(302, '/login');

  return {
    run: await getRunInspector(user.id, params.runId),
    surfaceStates: operatorSurfaceStates,
  };
};
