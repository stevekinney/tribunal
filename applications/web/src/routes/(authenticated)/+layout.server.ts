import { redirect } from '@sveltejs/kit';
import { getReviewsEnabled } from '$lib/server/review/operator';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, url }) => {
  const { user } = locals;

  if (!user) {
    // Redirect to provider-agnostic login page with returnTo
    const returnTo = url.pathname + url.search;
    redirect(302, `/login?returnTo=${encodeURIComponent(returnTo)}`);
  }

  // Pure read (no upsert) so a settings-table write can never gate the whole
  // authenticated app. Surfaces the real global review state in the sidebar pill
  // instead of a hardcoded "Reviews active". Layout loads are cached across
  // client-side navigations, so this does not run on every page transition.
  const reviewsEnabled = await getReviewsEnabled(user.id);

  return { user, reviewsEnabled };
};
