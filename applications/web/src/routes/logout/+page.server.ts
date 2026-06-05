import { deleteNeonAuthTokenCookie } from '$lib/server/auth/neon-session';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
  deleteNeonAuthTokenCookie(event);
  return {};
};
