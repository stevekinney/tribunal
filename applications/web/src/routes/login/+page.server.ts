import { redirect } from '@sveltejs/kit';
import { isNeonAuthConfigured } from '$lib/server/auth/neon-auth-configured';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
  if (event.locals.user) {
    redirect(302, '/');
  }

  return {
    neonAuthConfigured: isNeonAuthConfigured(),
  };
};
