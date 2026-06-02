import { redirect } from '@sveltejs/kit';
import { invalidateSession, deleteSessionTokenCookie } from '$lib/server/auth/authentication';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals, cookies }) => {
  if (locals.session) {
    await invalidateSession(locals.session.id);
  }
  deleteSessionTokenCookie({ cookies });
  redirect(302, '/');
};
