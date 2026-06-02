/**
 * Development-only GitHub token login bootstrap.
 *
 * When `DEV_GITHUB_TOKEN_LOGIN=1` and `GITHUB_TOKEN` are both set in dev
 * mode, hitting `/login` auto-creates a session from the token's GitHub
 * identity — no OAuth browser flow needed.
 *
 * Compile-time `dev` flag from `$app/environment` makes this unreachable
 * in production builds.
 */
import type { RequestEvent } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { db } from '$lib/server/database';
import { user } from '@tribunal/database/schema';
import {
  generateSessionToken,
  createSession,
  setSessionTokenCookie,
  findAuthenticationAccount,
  findUserByEmail,
  createAuthenticationAccount,
  updateAuthenticationAccount,
  upsertOAuthConnection,
} from '$lib/server/auth/authentication';
import { validateHandle } from '$lib/server/auth/handle-generator';
import { invalidateGitHubAccessCache } from '$lib/server/github/access';
import { eq } from 'drizzle-orm';

import type { Endpoints } from '@octokit/types';

type GitHubUser = Endpoints['GET /user']['response']['data'];
type GitHubEmail = { email: string; primary: boolean; verified: boolean };

/**
 * Whether dev-token login is available: dev mode, `GITHUB_TOKEN` set,
 * not E2E, not CI.
 */
export function isDevTokenLoginEnabled(): boolean {
  if (!dev) return false;
  if (env.DEV_GITHUB_TOKEN_LOGIN !== '1') return false;
  if (!env.GITHUB_TOKEN) return false;
  if (env.E2E_TEST_MODE === '1') return false;
  if (env.CI) return false;
  return true;
}

/**
 * Create an authenticated session from `GITHUB_TOKEN`.
 *
 * Mirrors the OAuth callback pipeline:
 *   1. Existing auth account → update profile + sign in
 *   2. Verified email matches existing user → auto-link
 *   3. Otherwise → create new user
 */
export async function bootstrapSessionFromGitHubToken(event: RequestEvent): Promise<boolean> {
  const token = env.GITHUB_TOKEN!;

  const userResponse = await fetch('https://api.github.com/user', {
    headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'tribunal' },
  });

  if (!userResponse.ok) {
    console.error('[development-login] GITHUB_TOKEN is invalid or expired:', userResponse.status);
    return false;
  }

  const scopesHeader = userResponse.headers.get('X-OAuth-Scopes');
  const tokenScopes = scopesHeader && scopesHeader.trim() !== '' ? scopesHeader : 'repo,user:email';

  const githubUser = (await userResponse.json()) as GitHubUser;

  const emailsResponse = await fetch('https://api.github.com/user/emails', {
    headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'tribunal' },
  });

  let verifiedEmail: GitHubEmail | undefined;
  let bestEmail: GitHubEmail | undefined;

  if (emailsResponse.ok) {
    const emails = (await emailsResponse.json()) as GitHubEmail[];
    verifiedEmail = emails.find((e) => e.primary && e.verified) ?? emails.find((e) => e.verified);
    bestEmail = verifiedEmail ?? emails.find((e) => e.primary) ?? emails[0];
  }

  // 1. Returning user — existing auth account
  const existingAccount = await findAuthenticationAccount('github', String(githubUser.id));

  if (existingAccount) {
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

    await saveOAuthConnection(existingAccount.userId, String(githubUser.id), token, tokenScopes);
    await signInUser(event, existingAccount.userId);
    return true;
  }

  // 2. Email auto-linking (requires verified email)
  if (verifiedEmail?.email) {
    const existingUser = await findUserByEmail(verifiedEmail.email);
    if (existingUser) {
      try {
        await createAuthenticationAccount(existingUser.id, 'github', {
          providerUserId: String(githubUser.id),
          providerUsername: githubUser.login,
          email: verifiedEmail.email,
        });
      } catch (error) {
        // Race condition: auth account created by another request between check and insert
        if (error instanceof Error && 'code' in error && error.code === '23505') {
          console.error('[development-login] Auth account already exists (race condition)');
        } else {
          throw error;
        }
      }

      await saveOAuthConnection(existingUser.id, String(githubUser.id), token, tokenScopes);
      await signInUser(event, existingUser.id);
      return true;
    }
  }

  // Prevent duplicate accounts with unverified email
  if (bestEmail?.email && !verifiedEmail) {
    const existingUser = await findUserByEmail(bestEmail.email);
    if (existingUser) {
      console.error('[development-login] Email conflict with unverified email:', bestEmail.email);
      return false;
    }
  }

  // 3. New user
  const candidateHandle = githubUser.login.toLowerCase();
  const handleValidation = await validateHandle(candidateHandle);

  if (!handleValidation.valid) {
    console.error('[development-login] Handle unavailable:', candidateHandle);
    return false;
  }

  let newUser: { id: number };
  try {
    [newUser] = await db
      .insert(user)
      .values({
        username: candidateHandle,
        email: bestEmail?.email?.toLowerCase().trim() ?? null,
        name: githubUser.name ?? null,
        avatarUrl: githubUser.avatar_url ?? null,
      })
      .returning();
  } catch (error) {
    // Race condition: handle was taken between validate and insert (unique constraint 23505)
    if (error instanceof Error && 'code' in error && error.code === '23505') {
      console.error(
        '[development-login] Handle became unavailable during creation:',
        candidateHandle,
      );
      return false;
    }
    throw error;
  }

  try {
    await createAuthenticationAccount(newUser.id, 'github', {
      providerUserId: String(githubUser.id),
      providerUsername: githubUser.login,
      email: bestEmail?.email ?? null,
    });
  } catch (error) {
    // Race condition: auth account created by another request between check and insert
    if (error instanceof Error && 'code' in error && error.code === '23505') {
      console.error('[development-login] Auth account already exists (race condition)');
    } else {
      throw error;
    }
  }

  await saveOAuthConnection(newUser.id, String(githubUser.id), token, tokenScopes);
  await signInUser(event, newUser.id);
  return true;
}

async function signInUser(event: RequestEvent, userId: number): Promise<void> {
  const sessionToken = generateSessionToken();
  const session = await createSession(sessionToken, userId);
  setSessionTokenCookie(event, sessionToken, session.expiresAt);
}

/** Upsert OAuth connection and silently invalidate the access cache. */
async function saveOAuthConnection(
  userId: number,
  githubUserId: string,
  accessToken: string,
  scopes: string,
): Promise<void> {
  await upsertOAuthConnection(userId, 'github', {
    providerUserId: githubUserId,
    accessToken,
    refreshToken: null,
    expiresAt: null,
    scope: scopes,
  });

  try {
    await invalidateGitHubAccessCache(userId);
  } catch (e) {
    console.error('[development-login] Failed to invalidate GitHub access cache:', e);
  }
}
