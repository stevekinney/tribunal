import type { Cookies, RequestEvent } from '@sveltejs/kit';
import { eq, and, sql } from 'drizzle-orm';
import { encodeBase64url } from '@oslojs/encoding';
import { GitHub } from 'arctic';
import { db } from '$lib/server/database';
import {
  authAccount,
  type AuthAccount,
  oauthConnection,
  session as sessionTable,
  user as userTable,
  type Session,
} from '@tribunal/database/schema';
import { env } from '$env/dynamic/private';
import { encrypt, decrypt } from '$lib/server/encryption';
import { dev } from '$app/environment';

const DAY_IN_MS = 1000 * 60 * 60 * 24;

export const sessionCookieName = 'tribunal-session';

const githubRedirectUri =
  env.GITHUB_REDIRECT_URI ??
  (dev
    ? 'http://localhost:5173/login/github/callback'
    : 'https://tribunal.fyi/login/github/callback');

export const github = new GitHub(
  env.GITHUB_CLIENT_ID!,
  env.GITHUB_CLIENT_SECRET!,
  githubRedirectUri,
);

// User-level OAuth provider. GitHub is the only supported provider.
export type OAuthProvider = 'github';

export async function getOAuthConnection(userId: number, provider: OAuthProvider) {
  const [connection] = await db
    .select()
    .from(oauthConnection)
    .where(and(eq(oauthConnection.userId, userId), eq(oauthConnection.provider, provider)));

  if (!connection) return null;

  try {
    return {
      ...connection,
      accessToken: decrypt(connection.accessToken),
      refreshToken: connection.refreshToken ? decrypt(connection.refreshToken) : null,
    };
  } catch (error) {
    // Handle encryption key rotation or corrupted token data
    // Return null to force user to re-authenticate
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

  // Use Drizzle's onConflictDoUpdate for proper upsert
  // This avoids identity sequence issues from delete/insert pattern
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
    })
    .onConflictDoUpdate({
      target: [oauthConnection.userId, oauthConnection.provider],
      set: {
        providerUserId: data.providerUserId,
        accessToken: encryptedAccessToken,
        refreshToken: encryptedRefreshToken,
        expiresAt: data.expiresAt ?? null,
        scope: data.scope ?? null,
        updatedAt: new Date(),
      },
    });
}

export async function deleteOAuthConnection(userId: number, provider: OAuthProvider) {
  await db
    .delete(oauthConnection)
    .where(and(eq(oauthConnection.userId, userId), eq(oauthConnection.provider, provider)));
}

// ============================================================================
// OAuth State Management (for CSRF protection and flow tracking)
// ============================================================================

import type { AuthProvider } from '$lib/constants/authorization-providers';

export interface OAuthState {
  nonce: string; // CSRF protection
  provider: AuthProvider;
  intent: 'login' | 'link';
  returnTo: string;
  createdAt: number;
  linkUserId?: number; // For account linking - the user who initiated the link
}

const OAUTH_STATE_COOKIE = 'oauth_state';
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Generate a random nonce for CSRF protection.
 */
function generateNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return encodeBase64url(bytes);
}

/**
 * Create an OAuth state string for use in authorization URL.
 * The state is a random nonce used for CSRF protection.
 * Provider-specific data is stored in a separate cookie via setOAuthStateCookie.
 */
export function createOAuthState(): string {
  return generateNonce();
}

/**
 * Set the OAuth state cookie with the full state payload.
 */
export function setOAuthStateCookie(
  cookies: Cookies,
  stateNonce: string,
  provider: AuthProvider,
  intent: 'login' | 'link',
  returnTo: string,
  linkUserId?: number,
): void {
  const payload: OAuthState = {
    nonce: stateNonce,
    provider,
    intent,
    returnTo: sanitizeReturnTo(returnTo),
    createdAt: Date.now(),
    linkUserId,
  };

  cookies.set(OAUTH_STATE_COOKIE, JSON.stringify(payload), {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: !dev,
    maxAge: 600, // 10 minutes
  });
}

/**
 * Consume and validate the OAuth state cookie.
 * Returns null if invalid, expired, or nonce mismatch.
 */
export function consumeOAuthStateCookie(
  cookies: Cookies,
  expectedNonce: string,
): OAuthState | null {
  const raw = cookies.get(OAUTH_STATE_COOKIE);
  cookies.delete(OAUTH_STATE_COOKIE, { path: '/' });

  if (!raw) return null;

  try {
    const state = JSON.parse(raw) as OAuthState;

    // Validate nonce
    if (state.nonce !== expectedNonce) return null;

    // Validate TTL
    if (Date.now() - state.createdAt > OAUTH_STATE_TTL_MS) return null;

    return state;
  } catch {
    return null;
  }
}

/**
 * Sanitize the returnTo URL to prevent open redirects.
 * Only allows relative paths on the same origin.
 */
export function sanitizeReturnTo(url: string | null): string {
  if (!url) return '/';

  // Must be relative path
  if (!url.startsWith('/')) return '/';

  // Prevent protocol-relative URLs
  if (url.startsWith('//')) return '/';

  // Block dangerous schemes
  const lower = url.toLowerCase();
  if (lower.startsWith('javascript:') || lower.startsWith('data:')) return '/';

  // Parse and reconstruct to strip any domain
  try {
    const parsed = new URL(url, 'https://placeholder.com');
    // Include hash fragment for in-app state (e.g., /settings#security)
    return parsed.pathname + parsed.search + parsed.hash;
  } catch {
    return '/';
  }
}

// ============================================================================
// Re-authentication for Sensitive Operations
// ============================================================================

const REAUTH_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const REAUTH_INTENT_TTL_MS = 10 * 60 * 1000; // 10 minutes
const REAUTH_INTENT_COOKIE = 'reauth_intent';

export interface ReauthIntent {
  action: 'link';
  provider: AuthProvider;
  userId: number; // Bind to user (NOT session - sessions may rotate)
  returnTo: string; // Where to resume after re-auth
  createdAt: number; // For TTL check
  actionLabel?: string; // Human-readable description of why re-auth is needed
}

/**
 * Check if the session was recently authenticated.
 * Returns true if lastAuthAt is within the re-auth window.
 */
export function isSessionFresh(session: Session): boolean {
  return Date.now() - session.lastAuthAt.getTime() < REAUTH_WINDOW_MS;
}

/**
 * Set the re-auth intent cookie.
 * This stores the action to perform after successful re-authentication.
 */
export function setReauthIntentCookie(cookies: Cookies, intent: ReauthIntent): void {
  cookies.set(REAUTH_INTENT_COOKIE, JSON.stringify(intent), {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: !dev,
    maxAge: 600, // 10 minutes
  });
}

/**
 * Consume and validate the re-auth intent cookie.
 * Returns null if invalid, expired, or user mismatch.
 */
export function consumeReauthIntentCookie(cookies: Cookies, userId: number): ReauthIntent | null {
  const raw = cookies.get(REAUTH_INTENT_COOKIE);
  cookies.delete(REAUTH_INTENT_COOKIE, { path: '/' });

  if (!raw) return null;

  try {
    const intent = JSON.parse(raw) as ReauthIntent;

    // Validate user binding
    if (intent.userId !== userId) return null;

    // Validate TTL
    if (Date.now() - intent.createdAt > REAUTH_INTENT_TTL_MS) return null;

    return intent;
  } catch {
    return null;
  }
}

/**
 * Clear the re-auth intent cookie without consuming.
 * Used when re-auth fails and we need to abort the flow.
 */
export function clearReauthIntentCookie(cookies: Cookies): void {
  cookies.delete(REAUTH_INTENT_COOKIE, { path: '/' });
}

/**
 * Peek at the re-auth intent cookie without consuming it.
 * Used to display context on the re-auth page.
 */
export function peekReauthIntentCookie(cookies: Cookies, userId: number): ReauthIntent | null {
  const raw = cookies.get(REAUTH_INTENT_COOKIE);
  if (!raw) return null;

  try {
    const intent = JSON.parse(raw) as ReauthIntent;

    // Validate user binding
    if (intent.userId !== userId) return null;

    // Validate TTL
    if (Date.now() - intent.createdAt > REAUTH_INTENT_TTL_MS) return null;

    return intent;
  } catch {
    return null;
  }
}

/**
 * Refresh the session's lastAuthAt timestamp.
 * Called on successful re-authentication.
 * Note: Does NOT rotate the session - just updates lastAuthAt.
 */
export async function refreshSessionAuth(sessionId: string): Promise<void> {
  await db
    .update(sessionTable)
    .set({ lastAuthAt: new Date() })
    .where(eq(sessionTable.id, sessionId));
}

// ============================================================================
// Session Token Management
// ============================================================================

export function generateSessionToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  const token = encodeBase64url(bytes);
  return token;
}

async function hashTokenHex(token: string): Promise<string> {
  const data = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(digest);
  let hex = '';
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
}

export async function createSession(token: string, userId: number) {
  const sessionId = await hashTokenHex(token);
  const now = new Date();
  const newSession: Session = {
    id: sessionId,
    userId,
    expiresAt: new Date(Date.now() + DAY_IN_MS * 30),
    lastAuthAt: now,
  };
  await db.insert(sessionTable).values(newSession);
  return newSession;
}

export async function validateSessionToken(token: string) {
  const sessionId = await hashTokenHex(token);
  const [result] = await db
    .select({
      user: {
        id: userTable.id,
        username: userTable.username,
        name: userTable.name,
        avatarUrl: userTable.avatarUrl,
        email: userTable.email,
        isPlatformAdministrator: userTable.isPlatformAdministrator,
      },
      session: sessionTable,
    })
    .from(sessionTable)
    .innerJoin(userTable, eq(sessionTable.userId, userTable.id))
    .where(eq(sessionTable.id, sessionId));

  if (!result) {
    return { session: null, user: null };
  }
  const { session, user } = result;

  const sessionExpired = Date.now() >= session.expiresAt.getTime();
  if (sessionExpired) {
    await db.delete(sessionTable).where(eq(sessionTable.id, session.id));
    return { session: null, user: null };
  }

  const renewSession = Date.now() >= session.expiresAt.getTime() - DAY_IN_MS * 15;
  if (renewSession) {
    session.expiresAt = new Date(Date.now() + DAY_IN_MS * 30);
    await db
      .update(sessionTable)
      .set({ expiresAt: session.expiresAt })
      .where(eq(sessionTable.id, session.id));
  }

  return { session, user };
}

export type SessionValidationResult = Awaited<ReturnType<typeof validateSessionToken>>;

export async function invalidateSession(sessionId: string) {
  await db.delete(sessionTable).where(eq(sessionTable.id, sessionId));
}

export function setSessionTokenCookie(
  target: Pick<RequestEvent, 'cookies'> | { cookies: Cookies },
  token: string,
  expiresAt: Date,
) {
  // In E2E test mode, allow non-secure cookies for HTTP testing
  const isE2EMode = env.E2E_TEST_MODE === '1';
  const baseOptions = {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: !dev && !isE2EMode,
    path: '/',
  };

  target.cookies.set(sessionCookieName, token, {
    ...baseOptions,
    expires: expiresAt,
  });
}

export function deleteSessionTokenCookie(
  target: Pick<RequestEvent, 'cookies'> | { cookies: Cookies },
) {
  // In E2E test mode, allow non-secure cookies for HTTP testing
  const isE2EMode = env.E2E_TEST_MODE === '1';
  target.cookies.delete(sessionCookieName, {
    httpOnly: true,
    sameSite: 'lax',
    secure: !dev && !isE2EMode,
    path: '/',
  });
}

// Health check helpers

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
    // Validate the OAuth token by making a test API call
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

// ============================================================================
// Token refresh for GitHub OAuth
// ============================================================================

export async function refreshGitHubTokenIfNeeded(userId: number): Promise<string | null> {
  const connection = await getOAuthConnection(userId, 'github');
  if (!connection) return null;

  // Standard GitHub OAuth tokens don't expire (expiresAt is null)
  // Only GitHub App user-to-server tokens with expiration enabled have expiresAt set
  if (!connection.expiresAt) {
    return connection.accessToken;
  }

  // Token has expiration - check if still valid (with 5-minute buffer)
  if (connection.expiresAt.getTime() > Date.now() + 5 * 60 * 1000) {
    return connection.accessToken;
  }

  // Token is expired or expiring soon - need to refresh
  if (!connection.refreshToken) {
    // Token expired but no refresh token available - user must re-authenticate
    // Return null to match function contract; caller should redirect to re-auth
    console.warn(`GitHub token expired for user ${userId} but no refresh token available`);
    return null;
  }

  try {
    const tokens = await github.refreshAccessToken(connection.refreshToken);

    await upsertOAuthConnection(userId, 'github', {
      providerUserId: connection.providerUserId,
      accessToken: tokens.accessToken(),
      refreshToken: tokens.hasRefreshToken() ? tokens.refreshToken() : null,
      // Preserve expiration behavior: GitHub App tokens with expiration enabled
      // will have an expiresAt from the refresh response, standard OAuth tokens won't
      expiresAt: tokens.accessTokenExpiresAt() ?? null,
      scope: connection.scope,
    });

    return tokens.accessToken();
  } catch (e) {
    console.error('Failed to refresh GitHub token:', e);
    return null;
  }
}

// ============================================================================
// Auth Account Management
// ============================================================================

export interface AuthenticationAccountData {
  providerUserId: string;
  providerUsername?: string | null;
  email?: string | null;
}

/**
 * Find an auth account by provider and provider user ID.
 */
export async function findAuthenticationAccount(provider: AuthProvider, providerUserId: string) {
  const [result] = await db
    .select()
    .from(authAccount)
    .where(and(eq(authAccount.provider, provider), eq(authAccount.providerUserId, providerUserId)))
    .limit(1);
  return result ?? null;
}

/**
 * Find a user by their email address (case-insensitive).
 */
export async function findUserByEmail(email: string) {
  const [result] = await db
    .select()
    .from(userTable)
    .where(sql`lower(${userTable.email}) = lower(${email})`)
    .limit(1);
  return result ?? null;
}

/**
 * Create a new auth account linked to a user.
 */
export async function createAuthenticationAccount(
  userId: number,
  provider: AuthProvider,
  data: AuthenticationAccountData,
): Promise<AuthAccount> {
  const [account] = await db
    .insert(authAccount)
    .values({
      userId,
      provider,
      providerUserId: data.providerUserId,
      providerUsername: data.providerUsername ?? null,
      email: data.email ?? null,
    })
    .returning();

  return account;
}

/**
 * Update an existing auth account with new data from the provider.
 * Call this on each login to keep provider data fresh.
 *
 * Note: email is only updated if the new value is not null/undefined.
 * This prevents providers that stop providing email from wiping existing data.
 */
export async function updateAuthenticationAccount(
  accountId: number,
  userId: number,
  data: Partial<AuthenticationAccountData>,
): Promise<void> {
  // Build update object, excluding null/undefined email to prevent overwrites
  const updateData: Record<string, unknown> = {
    updatedAt: new Date(),
  };

  if (data.providerUsername !== undefined) {
    updateData.providerUsername = data.providerUsername;
  }

  // Only update email fields if new value is truthy (not null/undefined/empty).
  // This prevents providers that fail to return email data from wiping existing values.
  if (data.email) {
    updateData.email = data.email;
  }

  await db.update(authAccount).set(updateData).where(eq(authAccount.id, accountId));
}

/**
 * List all auth accounts for a user.
 */
export async function listAuthenticationAccountsForUser(userId: number): Promise<AuthAccount[]> {
  return db.select().from(authAccount).where(eq(authAccount.userId, userId));
}

/**
 * Get a specific auth account for a user by provider.
 */
export async function getAuthenticationAccountByProvider(
  userId: number,
  provider: AuthProvider,
): Promise<AuthAccount | null> {
  const [result] = await db
    .select()
    .from(authAccount)
    .where(and(eq(authAccount.userId, userId), eq(authAccount.provider, provider)))
    .limit(1);
  return result ?? null;
}

/**
 * Unlink an auth account from a user, ensuring at least one remains.
 * Uses FOR UPDATE to lock rows and prevent concurrent deletes from racing.
 *
 * Note: This does NOT delete the associated oauth_connection (API access tokens).
 * A user may still need API access even if not using the provider for login.
 *
 * @returns 'success' if unlinked, 'last_account' if it's the only account, 'not_found' if not linked
 */
export async function unlinkAuthenticationAccount(
  userId: number,
  provider: AuthProvider,
): Promise<'success' | 'last_account' | 'not_found'> {
  // Use FOR UPDATE in the subquery to lock all auth_account rows for this user.
  // This serializes concurrent unlink requests, preventing the race condition where
  // two requests could both see count=2 and delete their respective rows.
  const result = await db.execute<{ id: number }>(sql`
    DELETE FROM auth_account
    WHERE user_id = ${userId}
      AND provider = ${provider}
      AND (SELECT count(*) FROM auth_account WHERE user_id = ${userId} FOR UPDATE) > 1
    RETURNING id
  `);

  if (result.rowCount && result.rowCount > 0) {
    return 'success';
  }

  // Check if the account exists but wasn't deleted (last account case)
  const [existing] = await db
    .select({ id: authAccount.id })
    .from(authAccount)
    .where(and(eq(authAccount.userId, userId), eq(authAccount.provider, provider)))
    .limit(1);

  if (existing) {
    return 'last_account';
  }

  return 'not_found';
}

/**
 * Count auth accounts for a user.
 * Useful for checking if unlinking is allowed (must have at least 1).
 */
export async function countAuthenticationAccountsForUser(userId: number): Promise<number> {
  const [result] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(authAccount)
    .where(eq(authAccount.userId, userId));
  return result?.count ?? 0;
}
