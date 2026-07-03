import type { Endpoints } from '@octokit/types';
import { env } from '$env/dynamic/private';
import { and, eq, sql } from 'drizzle-orm';
import { githubInstallation, oauthConnection, user as userTable } from '@tribunal/database/schema';
import { db } from '$lib/server/database';
import { slugify } from '$lib/utilities/slugify';
import { deleteOAuthConnection, upsertOAuthConnection } from './authentication';
import { validateHandleFormat } from './handle-generator';
import type { AuthenticatedApplicationUser, NeonSession } from './neon-session';

const BYPASS_FLAG = '1';

const userColumns = {
  id: userTable.id,
  username: userTable.username,
  name: userTable.name,
  avatarUrl: userTable.avatarUrl,
  email: userTable.email,
  isPlatformAdministrator: userTable.isPlatformAdministrator,
} as const;

type GitHubUser = Endpoints['GET /user']['response']['data'];

type DevGitHubBypassSession = {
  user: AuthenticatedApplicationUser;
  neonSession: NeonSession;
};

let devGitHubBypassSessionPromise: Promise<DevGitHubBypassSession> | null = null;

function normalizeGitHubToken(rawToken: string | undefined): string | null {
  const token = rawToken?.trim();
  return token && token.length > 0 ? token : null;
}

async function readGitHubTokenFromCli(): Promise<string> {
  const [{ execFile }, { promisify }] = await Promise.all([
    import('node:child_process'),
    import('node:util'),
  ]);
  const execFileAsync = promisify(execFile);

  try {
    const { stdout } = await execFileAsync('gh', ['auth', 'token', '--hostname', 'github.com'], {
      encoding: 'utf8',
      timeout: 5_000,
      maxBuffer: 1024 * 1024,
    });
    const token = normalizeGitHubToken(String(stdout));
    if (token) return token;
  } catch (error) {
    throw new Error(
      'Dev auth GitHub bypass: failed to read a token from the GitHub CLI. ' +
        'Run `gh auth login` or set DEV_AUTH_GITHUB_TOKEN.',
      { cause: error },
    );
  }

  throw new Error(
    'Dev auth GitHub bypass: the GitHub CLI returned an empty token. ' +
      'Run `gh auth login` or set DEV_AUTH_GITHUB_TOKEN.',
  );
}

async function readGitHubBypassToken(): Promise<string> {
  const environmentToken = normalizeGitHubToken(env.DEV_AUTH_GITHUB_TOKEN);
  if (environmentToken) return environmentToken;

  if (env.DEV_AUTH_GITHUB_TOKEN_FROM_GITHUB_CLI === BYPASS_FLAG) {
    return readGitHubTokenFromCli();
  }

  throw new Error(
    'Dev auth GitHub bypass requires DEV_AUTH_GITHUB_TOKEN or ' +
      'DEV_AUTH_GITHUB_TOKEN_FROM_GITHUB_CLI=1.',
  );
}

function readGitHubScopes(response: Response): string | null {
  return response.headers.get('X-OAuth-Scopes') || null;
}

function isGitHubUser(value: unknown): value is GitHubUser {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<GitHubUser>;
  return typeof candidate.id === 'number' && typeof candidate.login === 'string';
}

async function fetchGitHubBypassUser(accessToken: string): Promise<{
  user: GitHubUser;
  scopes: string | null;
}> {
  const response = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'User-Agent': 'tribunal',
    },
  });

  if (!response.ok) {
    throw new Error(
      `Dev auth GitHub bypass: GitHub token validation failed with status ${response.status}.`,
    );
  }

  const body: unknown = await response.json();
  if (!isGitHubUser(body)) {
    throw new Error('Dev auth GitHub bypass: GitHub returned an invalid user profile.');
  }

  return { user: body, scopes: readGitHubScopes(response) };
}

async function tokenCanListGitHubAppInstallations(accessToken: string): Promise<boolean> {
  const response = await fetch('https://api.github.com/user/installations?per_page=1', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'User-Agent': 'tribunal',
    },
  });

  if (response.ok) return true;

  if (response.status === 403) {
    return false;
  }

  throw new Error(
    `Dev auth GitHub bypass: GitHub App installation token check failed with status ${response.status}.`,
  );
}

async function findUserByGitHubProviderUserId(
  providerUserId: string,
): Promise<AuthenticatedApplicationUser | null> {
  const [result] = await db
    .select(userColumns)
    .from(userTable)
    .innerJoin(oauthConnection, eq(oauthConnection.userId, userTable.id))
    .where(
      and(
        eq(oauthConnection.provider, 'github'),
        eq(oauthConnection.providerUserId, providerUserId),
      ),
    )
    .limit(1);

  return result ?? null;
}

async function findUserByGitHubInstallationAccountLogin(
  accountLogin: string,
): Promise<AuthenticatedApplicationUser | null> {
  const [result] = await db
    .select(userColumns)
    .from(githubInstallation)
    .innerJoin(userTable, eq(userTable.id, githubInstallation.userId))
    .where(
      and(
        sql`lower(${githubInstallation.accountLogin}) = ${accountLogin.toLowerCase()}`,
        eq(githubInstallation.status, 'active'),
      ),
    )
    .limit(1);

  return result ?? null;
}

async function findDevGitHubUser(
  neonAuthUserId: string,
): Promise<AuthenticatedApplicationUser | null> {
  const [result] = await db
    .select(userColumns)
    .from(userTable)
    .where(eq(userTable.neonAuthUserId, neonAuthUserId))
    .limit(1);

  return result ?? null;
}

async function updateDevGitHubUserProfile(
  userId: number,
  githubUser: GitHubUser,
): Promise<AuthenticatedApplicationUser> {
  const updates: Partial<typeof userTable.$inferInsert> = {};

  if (githubUser.name) {
    updates.name = githubUser.name;
  }

  if (githubUser.avatar_url) {
    updates.avatarUrl = githubUser.avatar_url;
  }

  if (Object.keys(updates).length === 0) {
    const [user] = await db
      .select(userColumns)
      .from(userTable)
      .where(eq(userTable.id, userId))
      .limit(1);
    if (!user) {
      throw new Error(`Dev auth GitHub bypass: user ${userId} disappeared during profile update.`);
    }
    return user;
  }

  const [updatedUser] = await db
    .update(userTable)
    .set(updates)
    .where(eq(userTable.id, userId))
    .returning(userColumns);

  if (!updatedUser) {
    throw new Error(`Dev auth GitHub bypass: failed to update user ${userId}.`);
  }

  return updatedUser;
}

async function usernameExists(username: string): Promise<boolean> {
  const [existing] = await db
    .select({ id: userTable.id })
    .from(userTable)
    .where(sql`lower(${userTable.username}) = ${username}`)
    .limit(1);

  return Boolean(existing);
}

async function createUniqueGitHubUsername(githubUser: GitHubUser): Promise<string> {
  const normalizedLogin = slugify(githubUser.login);
  const base =
    normalizedLogin.length >= 3 ? normalizedLogin.slice(0, 39) : `github-${githubUser.id}`;

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const suffix = attempt === 0 ? '' : `-${attempt + 1}`;
    const username = `${base.slice(0, 39 - suffix.length)}${suffix}`;
    const validation = validateHandleFormat(username);
    if (!validation.valid) continue;
    if (!(await usernameExists(username))) return username;
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const suffix = `-${crypto.randomUUID().slice(0, 8)}`;
    const username = `${base.slice(0, 39 - suffix.length)}${suffix}`;
    const validation = validateHandleFormat(username);
    if (!validation.valid) continue;
    if (!(await usernameExists(username))) return username;
  }

  throw new Error(`Dev auth GitHub bypass: failed to create a username for ${githubUser.login}.`);
}

async function resolveGitHubBypassUser(
  githubUser: GitHubUser,
): Promise<AuthenticatedApplicationUser> {
  const providerUserId = String(githubUser.id);
  const existingProviderUser = await findUserByGitHubProviderUserId(providerUserId);
  if (existingProviderUser) {
    return updateDevGitHubUserProfile(existingProviderUser.id, githubUser);
  }

  const existingInstallationUser = await findUserByGitHubInstallationAccountLogin(githubUser.login);
  if (existingInstallationUser) {
    return updateDevGitHubUserProfile(existingInstallationUser.id, githubUser);
  }

  const neonAuthUserId = `dev-github:${providerUserId}`;
  const existingDevUser = await findDevGitHubUser(neonAuthUserId);
  if (existingDevUser) {
    return updateDevGitHubUserProfile(existingDevUser.id, githubUser);
  }

  const username = await createUniqueGitHubUsername(githubUser);
  const [createdUser] = await db
    .insert(userTable)
    .values({
      username,
      neonAuthUserId,
      name: githubUser.name ?? githubUser.login,
      avatarUrl: githubUser.avatar_url,
    })
    .returning(userColumns);

  if (!createdUser) {
    throw new Error(`Dev auth GitHub bypass: failed to create user "${username}".`);
  }

  return createdUser;
}

async function createDevGitHubBypassSession(): Promise<DevGitHubBypassSession> {
  const accessToken = await readGitHubBypassToken();
  const { user: githubUser, scopes } = await fetchGitHubBypassUser(accessToken);
  const user = await resolveGitHubBypassUser(githubUser);

  if (await tokenCanListGitHubAppInstallations(accessToken)) {
    await upsertOAuthConnection(user.id, 'github', {
      providerUserId: String(githubUser.id),
      accessToken,
      refreshToken: null,
      expiresAt: null,
      scope: scopes,
    });
  } else {
    await deleteOAuthConnection(user.id, 'github');
  }

  return {
    user,
    neonSession: {
      neonAuthUserId: `dev-github:${githubUser.id}`,
      expiresAt: new Date('2999-01-01T00:00:00.000Z'),
    },
  };
}

export async function resolveDevGitHubBypassSession(): Promise<DevGitHubBypassSession> {
  devGitHubBypassSessionPromise ??= createDevGitHubBypassSession();

  try {
    return await devGitHubBypassSessionPromise;
  } catch (error) {
    devGitHubBypassSessionPromise = null;
    throw error;
  }
}

export function resetDevGitHubBypassCacheForTests(): void {
  devGitHubBypassSessionPromise = null;
}
