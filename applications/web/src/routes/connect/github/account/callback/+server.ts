import { error, redirect } from '@sveltejs/kit';
import type { Endpoints } from '@octokit/types';
import { eq } from 'drizzle-orm';
import { consumeOAuthStateCookie, upsertOAuthConnection } from '$lib/server/auth/authentication';
import { getProviderClient } from '$lib/server/auth/providers';
import { invalidateGitHubAccessCache } from '$lib/server/github/access';
import { db } from '$lib/server/database';
import { user as userTable } from '@tribunal/database/schema';
import type { RequestHandler } from './$types';

type GitHubUser = Endpoints['GET /user']['response']['data'];

interface OAuthTokens {
  accessToken: string;
  refreshToken: string | null;
  scopes: string;
}

async function saveOAuthConnection(
  userId: number,
  githubUserId: string,
  tokens: OAuthTokens,
): Promise<void> {
  await upsertOAuthConnection(userId, 'github', {
    providerUserId: githubUserId,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt: null,
    scope: tokens.scopes,
  });

  try {
    await invalidateGitHubAccessCache(userId);
  } catch (error) {
    console.error('Failed to invalidate GitHub access cache:', error);
  }
}

export const GET: RequestHandler = async ({ locals, url, cookies }) => {
  if (!locals.user) {
    redirect(302, `/login?returnTo=${encodeURIComponent('/connect/github')}`);
  }

  const oauthError = url.searchParams.get('error');
  if (oauthError) {
    redirect(302, '/repositories?error=github_denied');
  }

  const code = url.searchParams.get('code');
  const stateParameter = url.searchParams.get('state');

  if (!code || !stateParameter) {
    error(400, 'Missing OAuth parameters');
  }

  const state = consumeOAuthStateCookie(cookies, stateParameter, locals.user.id);
  if (!state) {
    error(400, 'Invalid or expired OAuth state');
  }

  let rawTokens;
  try {
    const github = getProviderClient('github');
    rawTokens = await github.validateAuthorizationCode(code);
  } catch (error) {
    console.error('GitHub OAuth connection error:', error);
    redirect(302, '/repositories?error=github_failed');
  }

  const accessToken = rawTokens.accessToken();
  const tokens: OAuthTokens = {
    accessToken,
    refreshToken: rawTokens.hasRefreshToken() ? rawTokens.refreshToken() : null,
    scopes: '',
  };

  const githubUserResponse = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'User-Agent': 'tribunal',
    },
  });

  if (!githubUserResponse.ok) {
    error(400, 'Failed to fetch GitHub user');
  }

  tokens.scopes = githubUserResponse.headers.get('X-OAuth-Scopes') || 'repo,user:email';
  const githubUser = (await githubUserResponse.json()) as GitHubUser;

  await saveOAuthConnection(locals.user.id, String(githubUser.id), tokens);

  if (githubUser.avatar_url) {
    await db
      .update(userTable)
      .set({ avatarUrl: githubUser.avatar_url })
      .where(eq(userTable.id, locals.user.id));
  }

  redirect(302, state.returnTo);
};
