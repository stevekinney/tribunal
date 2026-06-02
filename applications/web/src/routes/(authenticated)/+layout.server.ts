import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, url }) => {
  const { user } = locals;

  if (!user) {
    // Redirect to provider-agnostic login page with returnTo
    const returnTo = url.pathname + url.search;
    redirect(302, `/login?returnTo=${encodeURIComponent(returnTo)}`);
  }

  return { user };
};
