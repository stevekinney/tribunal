import type { Cookies, RequestEvent } from '@sveltejs/kit';
import { error } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { and, eq, ne, sql } from 'drizzle-orm';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey, type JWTPayload } from 'jose';
import { user as userTable } from '@tribunal/database/schema';
import { db } from '$lib/server/database';
import { suggestHandle, validateHandle } from './handle-generator';
import { slugify } from '$lib/utilities/slugify';

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

  const baseUrl = options.baseUrl ?? getConfiguredNeonAuthBaseUrl();
  const issuerAndAudience = getNeonAuthIssuerAndAudience(baseUrl);
  const issuer = options.issuer ?? issuerAndAudience;
  const audience = options.audience ?? issuerAndAudience;
  const key = options.key ?? getRemoteJwks(baseUrl);

  let payload: JWTPayload;
  try {
    const result = await jwtVerify(token, key, {
      issuer,
      audience,
    });
    payload = result.payload;
  } catch (verificationError) {
    if (dev) {
      console.error('Neon Auth JWT verification failed', {
        issuer,
        audience,
        message:
          verificationError instanceof Error
            ? verificationError.message
            : 'Unknown verification failure',
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
  return {
    name: verifiedToken.name,
    avatarUrl: verifiedToken.avatarUrl,
    ...(includeEmail && verifiedToken.email ? { email: verifiedToken.email } : {}),
  };
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

    const [updatedUser] = await db
      .update(userTable)
      .set(profileUpdatesForExistingUser(verifiedToken, canUpdateEmail))
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
      if (existing.neonAuthUserId) {
        error(409, 'Email is already linked to another Neon Auth user');
      }

      const [updatedUser] = await db
        .update(userTable)
        .set({
          neonAuthUserId: verifiedToken.neonAuthUserId,
          name: verifiedToken.name,
          avatarUrl: verifiedToken.avatarUrl,
        })
        .where(eq(userTable.id, existing.id))
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
    .returning({
      id: userTable.id,
      username: userTable.username,
      name: userTable.name,
      avatarUrl: userTable.avatarUrl,
      email: userTable.email,
      isPlatformAdministrator: userTable.isPlatformAdministrator,
    });

  return newUser;
}

export async function createNeonSessionFromToken(
  token: string,
  options?: NeonTokenVerificationOptions,
): Promise<NeonSessionValidationResult> {
  const verifiedToken = await verifyNeonAuthToken(token, options);
  const user = await upsertApplicationUserFromNeonToken(verifiedToken);

  return {
    user,
    neonSession: {
      neonAuthUserId: verifiedToken.neonAuthUserId,
      expiresAt: verifiedToken.expiresAt,
    },
  };
}
