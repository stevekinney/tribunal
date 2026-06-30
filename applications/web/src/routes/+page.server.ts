import { redirect } from '@sveltejs/kit';
import { hasWatchedRepositories } from '$lib/server/review/operator';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  const { user } = locals;
  if (!user) return;

  // First-time guidance: a signed-in user who has not watched any repository yet
  // is guided to the onboarding repo picker (which itself handles the
  // not-yet-connected case). Returning users go straight to their repositories.
  // Single bounded existence check — only runs when landing on '/', not per page.
  const hasWatched = await hasWatchedRepositories(user.id);
  redirect(302, hasWatched ? '/repositories' : '/onboarding');
};
