import { error, redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import type { Cookies } from '@sveltejs/kit';
import type { Endpoints } from '@octokit/types';
import type { OAuthState } from '$lib/server/auth/authentication';
import {
  generateSessionToken,
  createSession,
  setSessionTokenCookie,
  upsertOAuthConnection,
  consumeOAuthStateCookie,
} from '$lib/server/auth/authentication';
import { validateHandle } from '$lib/server/auth/handle-generator';
import { getProviderClient } from '$lib/server/auth/providers';
import {
  findAuthenticationAccount,
  findUserByEmail,
  createAuthenticationAccount,
  updateAuthenticationAccount,
} from '$lib/server/auth/authentication';
import { db } from '$lib/server/database';
import { user } from '@tribunal/database/schema';
import { invalidateGitHubAccessCache } from '$lib/server/github/access';
import type { RequestHandler } from './$types';

type GitHubUser = Endpoints['GET /user']['response']['data'];
type GitHubEmail = { email: string; primary: boolean; verified: boolean };

interface OAuthTokens {
  accessToken: string;
  refreshToken: string | null;
  scopes: string;
}

/** Create a session and set the cookie for a given user. */
async function signInUser(cookies: Cookies, userId: number): Promise<void> {
  const sessionToken = generateSessionToken();
  const session = await createSession(sessionToken, userId);
  setSessionTokenCookie({ cookies }, sessionToken, session.expiresAt);
}

/** Upsert OAuth connection and silently invalidate the access cache. */
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
  } catch (e) {
    console.error('Failed to invalidate GitHub access cache:', e);
  }
}

/** Handle returning user — update profile and sign in. */
async function handleExistingUser(
  cookies: Cookies,
  state: OAuthState,
  githubUser: GitHubUser,
  verifiedEmail: GitHubEmail | undefined,
  bestEmail: GitHubEmail | undefined,
  tokens: OAuthTokens,
): Promise<void> {
  const existingAccount = await findAuthenticationAccount('github', String(githubUser.id));
  if (!existingAccount) return;

  await updateAuthenticationAccount(existingAccount.id, existingAccount.userId, {
    providerUsername: githubUser.login,
    email: verifiedEmail?.email ?? bestEmail?.email ?? null,
  });

  await db
    .update(user)
    .set({
      name: githubUser.name ?? undefined,
      avatarUrl: githubUser.avatar_url ?? undefined,
    })
    .where(eq(user.id, existingAccount.userId));

  await saveOAuthConnection(existingAccount.userId, String(githubUser.id), tokens);
  await signInUser(cookies, existingAccount.userId);
  redirect(302, state.returnTo);
}

/** Try to auto-create a new user using the GitHub login as handle. */
async function tryAutoCreateUser(
  cookies: Cookies,
  state: OAuthState,
  githubUser: GitHubUser,
  bestEmail: GitHubEmail | undefined,
  tokens: OAuthTokens,
): Promise<void> {
  const candidateHandle = githubUser.login.toLowerCase();
  const handleValidation = await validateHandle(candidateHandle);
  if (!handleValidation.valid) {
    redirect(302, '/login?error=handle_unavailable');
  }

  try {
    const [newUser] = await db
      .insert(user)
      .values({
        username: candidateHandle,
        email: bestEmail?.email?.toLowerCase().trim() ?? null,
        name: githubUser.name ?? null,
        avatarUrl: githubUser.avatar_url ?? null,
      })
      .returning();

    await createAuthenticationAccount(newUser.id, 'github', {
      providerUserId: String(githubUser.id),
      providerUsername: githubUser.login,
      email: bestEmail?.email ?? null,
    });

    await saveOAuthConnection(newUser.id, String(githubUser.id), tokens);
    await signInUser(cookies, newUser.id);
    redirect(302, state.returnTo);
  } catch (err) {
    // Race condition: handle was taken between validate and insert (unique constraint 23505)
    // Non-Error throws (e.g. SvelteKit Redirect) are re-thrown.
    if (!(err instanceof Error && 'code' in err && err.code === '23505')) {
      throw err;
    }
    redirect(302, '/login?error=handle_unavailable');
  }
}

export const GET: RequestHandler = async ({ url, cookies }) => {
  const oauthError = url.searchParams.get('error');
  if (oauthError) {
    redirect(302, '/login?error=github_denied');
  }

  const code = url.searchParams.get('code');
  const stateParam = url.searchParams.get('state');

  if (!code || !stateParam) {
    error(400, 'Missing OAuth parameters');
  }

  const state = consumeOAuthStateCookie(cookies, stateParam);
  if (!state) {
    error(400, 'Invalid or expired OAuth state');
  }

  let rawTokens;
  try {
    const github = getProviderClient('github');
    rawTokens = await github.validateAuthorizationCode(code);
  } catch (e) {
    console.error('GitHub OAuth error:', e);
    redirect(302, '/login?error=github_failed');
  }

  const accessToken = rawTokens.accessToken();
  const tokens: OAuthTokens = {
    accessToken,
    refreshToken: rawTokens.hasRefreshToken() ? rawTokens.refreshToken() : null,
    scopes: '',
  };

  // Fetch user info
  const githubUserResponse = await fetch('https://api.github.com/user', {
    headers: { Authorization: `Bearer ${accessToken}`, 'User-Agent': 'tribunal' },
  });

  if (!githubUserResponse.ok) {
    error(400, 'Failed to fetch GitHub user');
  }

  tokens.scopes = githubUserResponse.headers.get('X-OAuth-Scopes') || 'repo,user:email';
  const githubUser = (await githubUserResponse.json()) as GitHubUser;

  // Fetch user emails
  const emailsResponse = await fetch('https://api.github.com/user/emails', {
    headers: { Authorization: `Bearer ${accessToken}`, 'User-Agent': 'tribunal' },
  });

  let verifiedEmail: GitHubEmail | undefined;
  let bestEmail: GitHubEmail | undefined;
  if (emailsResponse.ok) {
    const emails = (await emailsResponse.json()) as GitHubEmail[];
    console.log('[GitHub OAuth] Emails from API:', JSON.stringify(emails));
    verifiedEmail = emails.find((e) => e.primary && e.verified) ?? emails.find((e) => e.verified);
    bestEmail = verifiedEmail ?? emails.find((e) => e.primary) ?? emails[0];
    console.log('[GitHub OAuth] Verified email:', verifiedEmail?.email ?? 'none');
    console.log('[GitHub OAuth] Best email:', bestEmail?.email ?? 'none');
  } else {
    console.log(
      '[GitHub OAuth] Emails API failed:',
      emailsResponse.status,
      await emailsResponse.text(),
    );
  }

  // Returning user — sign in
  await handleExistingUser(cookies, state, githubUser, verifiedEmail, bestEmail, tokens);

  // New user — check for email-based auto-linking (requires verified email for security)
  if (verifiedEmail?.email) {
    const existingUser = await findUserByEmail(verifiedEmail.email);
    if (existingUser) {
      await createAuthenticationAccount(existingUser.id, 'github', {
        providerUserId: String(githubUser.id),
        providerUsername: githubUser.login,
        email: verifiedEmail.email,
      });

      await saveOAuthConnection(existingUser.id, String(githubUser.id), tokens);
      await signInUser(cookies, existingUser.id);
      redirect(302, state.returnTo);
    }
  }

  // Unverified email matching an existing user — prevent duplicate accounts
  if (bestEmail?.email && !verifiedEmail) {
    const existingUser = await findUserByEmail(bestEmail.email);
    if (existingUser) {
      redirect(302, '/login?error=email_conflict');
    }
  }

  // New user — try auto-handle from GitHub login
  // (redirects to /login?error=handle_unavailable if handle is invalid or taken)
  await tryAutoCreateUser(cookies, state, githubUser, bestEmail, tokens);

  // Safety catch-all — should not normally be reached
  redirect(302, '/login?error=handle_unavailable');
};
