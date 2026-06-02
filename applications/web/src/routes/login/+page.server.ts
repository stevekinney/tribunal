import { redirect } from '@sveltejs/kit';
import {
  isDevTokenLoginEnabled,
  bootstrapSessionFromGitHubToken,
} from '$lib/server/auth/development-login';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
  if (event.locals.user) {
    redirect(302, '/');
  }

  if (isDevTokenLoginEnabled()) {
    const success = await bootstrapSessionFromGitHubToken(event);
    if (success) {
      redirect(302, '/');
    }
  }

  return {};
};
