import { redirect } from '@sveltejs/kit';
import { getRepositoriesForUser } from '$lib/server/repositories';
import type { PageServerLoad } from './$types';

/**
 * Lists the repositories the logged-in user can reach through their GitHub App
 * installations. When the user has no GitHub connection at all we surface a
 * connect prompt rather than erroring out.
 */
export const load: PageServerLoad = async ({ locals }) => {
  const { user } = locals;
  if (!user) {
    redirect(302, '/login');
  }

  const result = await getRepositoriesForUser(user.id);

  if (!result.ok) {
    // No usable GitHub token, or GitHub was unreachable. Render the page with a
    // connect prompt instead of a hard error so the user has an obvious next step.
    return {
      repositories: [],
      needsConnect: result.error === 'no_github_token',
      loadError: result.error === 'github_unavailable' ? result.message : null,
    };
  }

  return {
    repositories: result.repositories.map((entry) => ({
      id: entry.repository.id,
      owner: entry.repository.owner,
      name: entry.repository.name,
      defaultBranch: entry.repository.defaultBranch,
      accountLogin: entry.installation.accountLogin,
      accountAvatarUrl: entry.installation.accountAvatarUrl,
    })),
    needsConnect: false,
    loadError: null,
  };
};
