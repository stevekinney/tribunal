import { redirect } from '@sveltejs/kit';
import { deleteNeonAuthTokenCookie } from '$lib/server/auth/neon-session';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ cookies }) => {
  deleteNeonAuthTokenCookie({ cookies });
  redirect(302, '/');
};
