import { redirect } from '@sveltejs/kit';
import { getCostOverview, operatorSurfaceStates } from '$lib/server/review/operator';
import type { PageServerLoad } from './$types';

// Only estimated cost is available. Per-run reconciliation against the
// Anthropic Usage & Cost API is not possible: that endpoint only reports
// organization-wide daily totals (no run, request, or API-key dimension), so
// there is no reconciled figure to show per review run. See #215.
export const load: PageServerLoad = async ({ locals }) => {
  const { user } = locals;
  if (!user) redirect(302, '/login');

  return {
    costs: await getCostOverview(user.id, 'estimate'),
    surfaceStates: operatorSurfaceStates,
  };
};
