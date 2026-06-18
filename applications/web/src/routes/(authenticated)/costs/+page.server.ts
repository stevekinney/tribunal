import { redirect } from '@sveltejs/kit';
import { getCostOverview, operatorSurfaceStates } from '$lib/server/review/operator';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
  const { user } = locals;
  if (!user) redirect(302, '/login');

  const source = url.searchParams.get('source') === 'reconciled' ? 'reconciled' : 'estimate';
  return {
    costs: await getCostOverview(user.id, source),
    surfaceStates: operatorSurfaceStates,
  };
};
