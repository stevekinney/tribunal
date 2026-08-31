import type { Cookies, RequestEvent } from '@sveltejs/kit';
import { error } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { and, eq, ne, sql } from 'drizzle-orm';
import {
  createRemoteJWKSet,
  jwtVerify,
  errors as joseErrors,
  type JWTVerifyGetKey,
  type JWTPayload,
} from 'jose';
import { user as userTable } from '@tribunal/database/schema';
import { db } from '$lib/server/database';
import { suggestHandle, validateHandle } from './handle-generator';
import { slugify } from '$lib/utilities/slugify';
import {
  describeAuthFailureForLogging,
  isTransientJwksFailure,
  TransientAuthInfrastructureError,
} from './neon-auth-failure';

export { TransientAuthInfrastructureError } from './neon-auth-failure';

export const neonAuthTokenCookieName = 'tribunal-neon-auth-token';

export type AuthenticatedApplicationUser = {
  id: number;
  username: string;
  name: string | null;
  avatarUrl: string | null;
  email: string | null;
  isPlatformAdministrator: boolean;
};

export type NeonSession = {
  neonAuthUserId: string;
  expiresAt: Date;
};

export type VerifiedNeonToken = NeonSession & {
  token: string;
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
};

export type NeonSessionValidationResult = {
  user: AuthenticatedApplicationUser;
  neonSession: NeonSession;
};

type VerificationKey = Parameters<typeof jwtVerify>[1];

export interface NeonTokenVerificationOptions {
  baseUrl?: string;
  issuer?: string;
  audience?: string;
  key?: VerificationKey;
}

const remoteJwksCache = new Map<string, JWTVerifyGetKey>();

function getConfiguredNeonAuthBaseUrl(): string {
  const baseUrl = env.NEON_AUTH_BASE_URL;
  if (!baseUrl) {
    throw new Error('NEON_AUTH_BASE_URL is required to verify Neon Auth tokens');
  }
  return baseUrl;
}

function normalizeNeonAuthBaseUrl(baseUrl: string): string {
  const parsed = new URL(baseUrl);
  const pathname = parsed.pathname.replace(/\/+$/, '');
  return `${parsed.origin}${pathname}`;
}

function getNeonAuthIssuerAndAudience(baseUrl: string): string {
  return new URL(baseUrl).origin;
}

function getRemoteJwks(baseUrl: string): JWTVerifyGetKey {
  const normalizedBaseUrl = normalizeNeonAuthBaseUrl(baseUrl);
  const jwksUrl = `${normalizedBaseUrl}/.well-known/jwks.json`;
  const cached = remoteJwksCache.get(jwksUrl);
  if (cached) return cached;

  const jwks = createRemoteJWKSet(new URL(jwksUrl));
  remoteJwksCache.set(jwksUrl, jwks);
  return jwks;
}

export function resetNeonAuthJwksCacheForTests(): void {
  remoteJwksCache.clear();
}

function getStringClaim(payload: JWTPayload, claimName: string): string | null {
  const value = payload[claimName];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function getNormalizedEmail(payload: JWTPayload): string | null {
  const email = getStringClaim(payload, 'email')?.trim().toLowerCase();
  return email && email.includes('@') ? email : null;
}

export async function verifyNeonAuthToken(
  token: string,
  options: NeonTokenVerificationOptions = {},
): Promise<VerifiedNeonToken> {
  if (!token) {
    error(401, 'Missing Neon Auth token');
  }

  // Resolving configuration (NEON_AUTH_BASE_URL) and constructing the JWKS
  // URL happen inside this same try block, not before it: a misconfigured
  // or momentarily-unparseable base URL is exactly the kind of
  // infrastructure problem isTransientJwksFailure already knows how to
  // classify (it throws a plain, non-JOSEError Error/TypeError, which falls
  // through to that function's transient-by-default case) -- it says
  // nothing about whether the presented token itself is valid, so it must
  // not clear the caller's session cookie either.
  let issuer: string | undefined;
  let audience: string | undefined;
  let payload: JWTPayload;
  try {
    const baseUrl = options.baseUrl ?? getConfiguredNeonAuthBaseUrl();
    const issuerAndAudience = getNeonAuthIssuerAndAudience(baseUrl);
    issuer = options.issuer ?? issuerAndAudience;
    audience = options.audience ?? issuerAndAudience;
    const key = options.key ?? getRemoteJwks(baseUrl);

    const result = await jwtVerify(token, key, { issuer, audience });
    payload = result.payload;
  } catch (verificationError) {
    if (isTransientJwksFailure(verificationError)) {
      throw new TransientAuthInfrastructureError('Neon Auth JWKS verification unavailable', {
        cause: verificationError,
      });
    }

    // isTransientJwksFailure already returned false above, which is only
    // possible when verificationError is a JOSEError subclass (see its
    // jsdoc) -- this guard is for TypeScript's benefit, not a real branch.
    if (verificationError instanceof joseErrors.JOSEError) {
      // Always logged (not dev-gated): production has no other signal for
      // why a Neon Auth session was rejected. Never logs the token or
      // decoded claims -- see describeAuthFailureForLogging.
      console.error('[neon-session] Rejecting Neon Auth token', {
        issuer,
        audience,
        ...describeAuthFailureForLogging(verificationError),
      });
    }
    error(401, 'Invalid Neon Auth token');
  }

  const neonAuthUserId = getStringClaim(payload, 'sub');
  if (!neonAuthUserId) {
    error(401, 'Invalid Neon Auth token subject');
  }

  if (!payload.exp) {
    error(401, 'Invalid Neon Auth token expiration');
  }

  return {
    token,
    neonAuthUserId,
    expiresAt: new Date(payload.exp * 1000),
    email: getNormalizedEmail(payload),
    name: getStringClaim(payload, 'name'),
    avatarUrl: getStringClaim(payload, 'picture') ?? getStringClaim(payload, 'avatar_url'),
  };
}

export function setNeonAuthTokenCookie(
  target: Pick<RequestEvent, 'cookies'> | { cookies: Cookies },
  token: string,
  expiresAt: Date,
): void {
  target.cookies.set(neonAuthTokenCookieName, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: !dev && env.E2E_TEST_MODE !== '1',
    path: '/',
    expires: expiresAt,
  });
}

export function deleteNeonAuthTokenCookie(
  target: Pick<RequestEvent, 'cookies'> | { cookies: Cookies },
): void {
  target.cookies.delete(neonAuthTokenCookieName, {
    httpOnly: true,
    sameSite: 'lax',
    secure: !dev && env.E2E_TEST_MODE !== '1',
    path: '/',
  });
}

export async function findUserByEmail(email: string): Promise<AuthenticatedApplicationUser | null> {
  const [result] = await db
    .select({
      id: userTable.id,
      username: userTable.username,
      name: userTable.name,
      avatarUrl: userTable.avatarUrl,
      email: userTable.email,
      isPlatformAdministrator: userTable.isPlatformAdministrator,
    })
    .from(userTable)
    .where(sql`lower(${userTable.email}) = lower(${email})`)
    .limit(1);

  return result ?? null;
}

async function findMappedUser(
  neonAuthUserId: string,
): Promise<AuthenticatedApplicationUser | null> {
  const [result] = await db
    .select({
      id: userTable.id,
      username: userTable.username,
      name: userTable.name,
      avatarUrl: userTable.avatarUrl,
      email: userTable.email,
      isPlatformAdministrator: userTable.isPlatformAdministrator,
    })
    .from(userTable)
    .where(eq(userTable.neonAuthUserId, neonAuthUserId))
    .limit(1);

  return result ?? null;
}

async function emailBelongsToAnotherUser(email: string, userId: number): Promise<boolean> {
  const [result] = await db
    .select({ id: userTable.id })
    .from(userTable)
    .where(and(sql`lower(${userTable.email}) = lower(${email})`, ne(userTable.id, userId)))
    .limit(1);

  return Boolean(result);
}

async function createUniqueHandle(verifiedToken: VerifiedNeonToken): Promise<string> {
  const base = verifiedToken.email
    ? suggestHandle(verifiedToken.name, verifiedToken.email)
    : slugify(verifiedToken.name ?? `user-${verifiedToken.neonAuthUserId}`).slice(0, 39);
  const normalizedBase = base.length >= 3 ? base : `user-${verifiedToken.neonAuthUserId}`;

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const suffix = attempt === 0 ? '' : `-${attempt + 1}`;
    const handle = `${normalizedBase.slice(0, 39 - suffix.length)}${suffix}`;
    const validation = await validateHandle(handle);
    if (validation.valid) return handle;
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const suffix = `-${crypto.randomUUID().slice(0, 8)}`;
    const handle = `${normalizedBase.slice(0, 39 - suffix.length)}${suffix}`;
    const validation = await validateHandle(handle);
    if (validation.valid) return handle;
  }

  error(409, 'Could not create an available Tribunal username');
}

function profileUpdatesForExistingUser(
  verifiedToken: VerifiedNeonToken,
  includeEmail: boolean,
): Partial<typeof userTable.$inferInsert> {
  const updates: Partial<typeof userTable.$inferInsert> = {};

  if (verifiedToken.name !== null) {
    updates.name = verifiedToken.name;
  }

  if (verifiedToken.avatarUrl !== null) {
    updates.avatarUrl = verifiedToken.avatarUrl;
  }

  if (includeEmail && verifiedToken.email) {
    updates.email = verifiedToken.email;
  }

  return updates;
}

export async function upsertApplicationUserFromNeonToken(
  verifiedToken: VerifiedNeonToken,
): Promise<AuthenticatedApplicationUser> {
  const mappedUser = await findMappedUser(verifiedToken.neonAuthUserId);

  if (mappedUser) {
    const canUpdateEmail = verifiedToken.email
      ? mappedUser.email?.toLowerCase() === verifiedToken.email ||
        !(await emailBelongsToAnotherUser(verifiedToken.email, mappedUser.id))
      : false;
    const updates = profileUpdatesForExistingUser(verifiedToken, canUpdateEmail);

    if (Object.keys(updates).length === 0) {
      return mappedUser;
    }

    const [updatedUser] = await db
      .update(userTable)
      .set(updates)
      .where(eq(userTable.id, mappedUser.id))
      .returning({
        id: userTable.id,
        username: userTable.username,
        name: userTable.name,
        avatarUrl: userTable.avatarUrl,
        email: userTable.email,
        isPlatformAdministrator: userTable.isPlatformAdministrator,
      });

    return updatedUser;
  }

  if (verifiedToken.email) {
    const emailMatchedUser = await db
      .select({
        id: userTable.id,
        username: userTable.username,
        name: userTable.name,
        avatarUrl: userTable.avatarUrl,
        email: userTable.email,
        isPlatformAdministrator: userTable.isPlatformAdministrator,
        neonAuthUserId: userTable.neonAuthUserId,
      })
      .from(userTable)
      .where(sql`lower(${userTable.email}) = lower(${verifiedToken.email})`)
      .limit(1);

    const existing = emailMatchedUser[0];
    if (existing) {
      if (existing.neonAuthUserId === verifiedToken.neonAuthUserId) {
        const { neonAuthUserId: _neonAuthUserId, ...applicationUser } = existing;
        return applicationUser;
      }

      error(409, 'Email is already linked to another Tribunal user');
    }
  }

  const username = await createUniqueHandle(verifiedToken);
  const [newUser] = await db
    .insert(userTable)
    .values({
      username,
      neonAuthUserId: verifiedToken.neonAuthUserId,
      email: verifiedToken.email,
      name: verifiedToken.name,
      avatarUrl: verifiedToken.avatarUrl,
    })
    .onConflictDoNothing()
    .returning({
      id: userTable.id,
      username: userTable.username,
      name: userTable.name,
      avatarUrl: userTable.avatarUrl,
      email: userTable.email,
      isPlatformAdministrator: userTable.isPlatformAdministrator,
    });

  if (newUser) {
    return newUser;
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const concurrentlyCreatedUser = await findMappedUser(verifiedToken.neonAuthUserId);
    if (concurrentlyCreatedUser) {
      return concurrentlyCreatedUser;
    }
  }

  error(409, 'Could not create a Tribunal user for this Neon Auth identity');
}

export async function createNeonSessionFromToken(
  token: string,
  options?: NeonTokenVerificationOptions,
): Promise<NeonSessionValidationResult> {
  const verifiedToken = await verifyNeonAuthToken(token, options);
  const user = await upsertApplicationUserFromNeonToken(verifiedToken);

  return createSessionValidationResult(verifiedToken, user);
}

export async function validateNeonSessionFromToken(
  token: string,
  options?: NeonTokenVerificationOptions,
): Promise<NeonSessionValidationResult> {
  const verifiedToken = await verifyNeonAuthToken(token, options);

  // The token is already cryptographically valid at this point, so any
  // throw from this lookup can only be a database availability problem --
  // never evidence that the token itself is bad.
  let user: AuthenticatedApplicationUser | null;
  try {
    user = await findMappedUser(verifiedToken.neonAuthUserId);
  } catch (databaseError) {
    throw new TransientAuthInfrastructureError('Neon Auth session lookup failed', {
      cause: databaseError,
    });
  }

  if (!user) {
    error(401, 'Neon Auth user is not linked to a Tribunal user');
  }

  return createSessionValidationResult(verifiedToken, user);
}

function createSessionValidationResult(
  verifiedToken: VerifiedNeonToken,
  user: AuthenticatedApplicationUser,
): NeonSessionValidationResult {
  return {
    user,
    neonSession: {
      neonAuthUserId: verifiedToken.neonAuthUserId,
      expiresAt: verifiedToken.expiresAt,
    },
  };
}
