import type { Cookies } from '@sveltejs/kit';
import type { OAuth2Tokens } from 'arctic';
import { dev } from '$app/environment';
import { eq, and } from 'drizzle-orm';
import { encodeBase64url } from '@oslojs/encoding';
import { oauthConnection } from '@tribunal/database/schema';
import { env } from '$env/dynamic/private';
import { db } from '$lib/server/database';
import { decrypt, encrypt } from '$lib/server/encryption';
import { sanitizeReturnTo } from '$lib/utilities/return-to';
import { getProviderClient } from './providers';
import type { AuthProvider } from '$lib/constants/authorization-providers';

export { sanitizeReturnTo };

// User-level OAuth provider. GitHub is the only supported provider.
export type OAuthProvider = 'github';

export async function getOAuthConnection(userId: number, provider: OAuthProvider) {
  const [connection] = await db
    .select()
    .from(oauthConnection)
    .where(and(eq(oauthConnection.userId, userId), eq(oauthConnection.provider, provider)));

  if (!connection || connection.status !== 'active') return null;

  try {
    return {
      ...connection,
      accessToken: decrypt(connection.accessToken),
      refreshToken: connection.refreshToken ? decrypt(connection.refreshToken) : null,
    };
  } catch (error) {
    console.error(
      `[getOAuthConnection] Failed to decrypt ${provider} token for user ${userId}:`,
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

export async function upsertOAuthConnection(
  userId: number,
  provider: OAuthProvider,
  data: {
    providerUserId: string;
    accessToken: string;
    refreshToken?: string | null;
    expiresAt?: Date | null;
    scope?: string | null;
  },
) {
  const encryptedAccessToken = encrypt(data.accessToken);
  const encryptedRefreshToken = data.refreshToken ? encrypt(data.refreshToken) : null;

  await db
    .insert(oauthConnection)
    .values({
      userId,
      provider,
      providerUserId: data.providerUserId,
      accessToken: encryptedAccessToken,
      refreshToken: encryptedRefreshToken,
      expiresAt: data.expiresAt ?? null,
      scope: data.scope ?? null,
      status: 'active',
    })
    .onConflictDoUpdate({
      target: [oauthConnection.userId, oauthConnection.provider],
      set: {
        providerUserId: data.providerUserId,
        accessToken: encryptedAccessToken,
        refreshToken: encryptedRefreshToken,
        expiresAt: data.expiresAt ?? null,
        scope: data.scope ?? null,
        status: 'active',
        updatedAt: new Date(),
      },
    });
}

export async function deleteOAuthConnection(userId: number, provider: OAuthProvider) {
  await db
    .delete(oauthConnection)
    .where(and(eq(oauthConnection.userId, userId), eq(oauthConnection.provider, provider)));
}

export interface OAuthState {
  nonce: string;
  provider: AuthProvider;
  intent: 'connect';
  returnTo: string;
  createdAt: number;
  userId: number;
}

const oauthStateCookieName = 'oauth_state';
const oauthStateTtlMilliseconds = 10 * 60 * 1000;

function generateNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return encodeBase64url(bytes);
}

export function createOAuthState(): string {
  return generateNonce();
}

export function setOAuthStateCookie(
  cookies: Cookies,
  stateNonce: string,
  provider: AuthProvider,
  returnTo: string,
  userId: number,
): void {
  const payload: OAuthState = {
    nonce: stateNonce,
    provider,
    intent: 'connect',
    returnTo: sanitizeReturnTo(returnTo),
    createdAt: Date.now(),
    userId,
  };

  cookies.set(oauthStateCookieName, JSON.stringify(payload), {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: !dev && env.E2E_TEST_MODE !== '1',
    maxAge: 600,
  });
}

export function consumeOAuthStateCookie(
  cookies: Cookies,
  expectedNonce: string,
  userId: number,
): OAuthState | null {
  const raw = cookies.get(oauthStateCookieName);
  cookies.delete(oauthStateCookieName, { path: '/' });

  if (!raw) return null;

  try {
    const state = JSON.parse(raw) as OAuthState;

    if (state.nonce !== expectedNonce) return null;
    if (state.intent !== 'connect') return null;
    if (state.userId !== userId) return null;
    if (Date.now() - state.createdAt > oauthStateTtlMilliseconds) return null;

    return {
      ...state,
      returnTo: sanitizeReturnTo(state.returnTo),
    };
  } catch {
    return null;
  }
}

export function shouldCheckHealth(lastCheckedAt: Date | null): boolean {
  if (!lastCheckedAt) return true;
  const hoursSinceCheck = (Date.now() - lastCheckedAt.getTime()) / (1000 * 60 * 60);
  return hoursSinceCheck > 24;
}

export async function validateAndUpdateConnectionHealth(
  userId: number,
  provider: OAuthProvider,
  accessToken: string,
): Promise<boolean> {
  let isValid = false;

  if (provider === 'github') {
    try {
      const response = await fetch('https://api.github.com/user', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'User-Agent': 'tribunal',
        },
      });
      isValid = response.ok;
    } catch {
      isValid = false;
    }
  }

  await db
    .update(oauthConnection)
    .set({
      status: isValid ? 'active' : 'invalid',
      lastCheckedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(oauthConnection.userId, userId), eq(oauthConnection.provider, provider)));

  return isValid;
}

/**
 * Read a token response's access-token expiry, tolerating providers that issue
 * non-expiring tokens. GitHub App user-to-server tokens include `expires_in`
 * (≈8h) plus a refresh token; classic OAuth App tokens omit it, and Arctic's
 * `accessTokenExpiresAt()` throws when the field is absent. A missing expiry is
 * returned as null, which `refreshGitHubTokenIfNeeded` treats as "never
 * expires" (so it is never refreshed). Shared by the connect callback and the
 * refresh path so both classify the expiry identically.
 */
/** Exact message Arctic throws from `accessTokenExpiresAt()` when the token
 * response carries no usable `expires_in` field (classic OAuth App tokens). */
const MISSING_EXPIRES_IN_MESSAGE = "Missing or invalid 'expires_in' field";

export function readAccessTokenExpiresAt(tokens: OAuth2Tokens): Date | null {
  try {
    return tokens.accessTokenExpiresAt();
  } catch (error) {
    // Only the known "no expiry" case is a non-expiring token. Re-throw anything
    // else so a genuinely malformed token response fails loudly at the callback
    // instead of being silently persisted as a token that never expires.
    if (error instanceof Error && error.message === MISSING_EXPIRES_IN_MESSAGE) {
      return null;
    }
    throw error;
  }
}

export async function refreshGitHubTokenIfNeeded(userId: number): Promise<string | null> {
  const connection = await getOAuthConnection(userId, 'github');
  if (!connection) return null;

  if (!connection.expiresAt) {
    return connection.accessToken;
  }

  if (connection.expiresAt.getTime() > Date.now() + 5 * 60 * 1000) {
    return connection.accessToken;
  }

  if (!connection.refreshToken) {
    console.warn(`GitHub token expired for user ${userId} but no refresh token is available`);
    return null;
  }

  try {
    const github = getProviderClient('github');
    const tokens = await github.refreshAccessToken(connection.refreshToken);

    await upsertOAuthConnection(userId, 'github', {
      providerUserId: connection.providerUserId,
      accessToken: tokens.accessToken(),
      refreshToken: tokens.hasRefreshToken() ? tokens.refreshToken() : null,
      expiresAt: readAccessTokenExpiresAt(tokens),
      scope: connection.scope,
    });

    return tokens.accessToken();
  } catch (error) {
    console.error('Failed to refresh GitHub token:', error);
    return null;
  }
}
