import { redirect } from '@sveltejs/kit';
import { env as privateEnv } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
  if (event.locals.user) {
    redirect(302, '/');
  }

  return {
    neonAuthConfigured: Boolean(publicEnv.PUBLIC_NEON_AUTH_URL && privateEnv.NEON_AUTH_BASE_URL),
  };
};
