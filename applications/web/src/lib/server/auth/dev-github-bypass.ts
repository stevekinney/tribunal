import { spawnSync } from 'node:child_process';
import { and, eq, sql } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import { db } from '$lib/server/database';
import { deleteOAuthConnection, upsertOAuthConnection } from './authentication';
import { validateHandleFormat } from './handle-generator';
import type { AuthenticatedApplicationUser, NeonSession } from './neon-session';
import { githubInstallation, oauthConnection, user as userTable } from '@tribunal/database/schema';

interface GitHubUserResponse {
  id: number;
  login: string;
  name: string | null;
  avatar_url: string | null;
  email?: string | null;
}

interface DevGitHubBypassSession {
  user: AuthenticatedApplicationUser;
  neonSession: NeonSession;
}

const userColumns = {
  id: userTable.id,
  username: userTable.username,
  name: userTable.name,
  avatarUrl: userTable.avatarUrl,
  email: userTable.email,
  isPlatformAdministrator: userTable.isPlatformAdministrator,
} as const;

let cachedSession: DevGitHubBypassSession | null = null;

export function resetDevGitHubBypassCacheForTests(): void {
  cachedSession = null;
}

function readGitHubTokenFromCli(): string | null {
  if (env.DEV_AUTH_GITHUB_TOKEN_FROM_GITHUB_CLI !== '1') return null;

  const result = spawnSync('gh', ['auth', 'token', '--hostname', 'github.com'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (result.status !== 0) {
    throw new Error(
      'DEV_AUTH_GITHUB_TOKEN_FROM_GITHUB_CLI=1 is set, but `gh auth token --hostname github.com` failed.',
    );
  }

  return result.stdout.trim() || null;
}

function resolveGitHubToken(): string {
  const configuredToken = env.DEV_AUTH_GITHUB_TOKEN?.trim();
  const token = configuredToken || readGitHubTokenFromCli();

  if (!token) {
    throw new Error(
      'DEV_AUTH_BYPASS_MODE=github requires DEV_AUTH_GITHUB_TOKEN or DEV_AUTH_GITHUB_TOKEN_FROM_GITHUB_CLI=1.',
    );
  }

  return token;
}

function gitHubRequestHeaders(token: string): HeadersInit {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'User-Agent': 'tribunal',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

async function fetchGitHubUser(
  token: string,
): Promise<{ user: GitHubUserResponse; scope: string | null }> {
  const response = await fetch('https://api.github.com/user', {
    headers: gitHubRequestHeaders(token),
  });

  if (!response.ok) {
    throw new Error(`Dev GitHub auth bypass: GitHub user lookup failed with ${response.status}.`);
  }

  const user = (await response.json()) as GitHubUserResponse;
  if (!Number.isFinite(user.id) || !user.login) {
    throw new Error('Dev GitHub auth bypass: GitHub user response did not include id and login.');
  }

  return { user, scope: response.headers.get('X-OAuth-Scopes') };
}

async function tokenCanListUserInstallations(token: string): Promise<boolean> {
  const response = await fetch('https://api.github.com/user/installations', {
    headers: gitHubRequestHeaders(token),
  });

  return response.ok;
}

function userFromGitHubUser(gitHubUser: GitHubUserResponse): {
  username: string;
  neonAuthUserId: string;
  name: string | null;
  avatarUrl: string | null;
  email: string | null;
} {
  const username = gitHubUser.login.trim().toLowerCase();
  const validation = validateHandleFormat(username);

  if (!validation.valid) {
    throw new Error(
      `Dev GitHub auth bypass: GitHub login ${JSON.stringify(username)} cannot be used as a Tribunal username (${validation.error}).`,
    );
  }

  return {
    username,
    neonAuthUserId: `dev-github:${gitHubUser.id}`,
    name: gitHubUser.name,
    avatarUrl: gitHubUser.avatar_url,
    email: gitHubUser.email ?? null,
  };
}

async function findUserByGitHubConnection(
  providerUserId: string,
): Promise<AuthenticatedApplicationUser | null> {
  const [row] = await db
    .select(userColumns)
    .from(userTable)
    .innerJoin(oauthConnection, eq(oauthConnection.userId, userTable.id))
    .where(
      and(
        eq(oauthConnection.provider, 'github'),
        eq(oauthConnection.providerUserId, providerUserId),
        eq(oauthConnection.status, 'active'),
      ),
    )
    .limit(1);

  return row ?? null;
}

async function findInstallationOwner(
  gitHubUserId: number,
): Promise<AuthenticatedApplicationUser | null> {
  const [row] = await db
    .select(userColumns)
    .from(userTable)
    .innerJoin(githubInstallation, eq(githubInstallation.userId, userTable.id))
    .where(
      and(eq(githubInstallation.accountId, gitHubUserId), eq(githubInstallation.status, 'active')),
    )
    .limit(1);

  return row ?? null;
}

async function findUserByNeonAuthUserId(
  neonAuthUserId: string,
): Promise<AuthenticatedApplicationUser | null> {
  const [row] = await db
    .select(userColumns)
    .from(userTable)
    .where(eq(userTable.neonAuthUserId, neonAuthUserId))
    .limit(1);

  return row ?? null;
}

async function usernameIsAvailable(username: string): Promise<boolean> {
  const [row] = await db
    .select({ id: userTable.id })
    .from(userTable)
    .where(sql`lower(${userTable.username}) = ${username}`)
    .limit(1);

  return !row;
}

async function updateUserFromGitHub(
  user: AuthenticatedApplicationUser,
  gitHubUser: GitHubUserResponse,
): Promise<AuthenticatedApplicationUser> {
  const [updated] = await db
    .update(userTable)
    .set({
      neonAuthUserId: `dev-github:${gitHubUser.id}`,
      name: gitHubUser.name,
      avatarUrl: gitHubUser.avatar_url,
    })
    .where(eq(userTable.id, user.id))
    .returning(userColumns);

  return updated ?? user;
}

async function createDevGitHubUser(
  gitHubUser: GitHubUserResponse,
): Promise<AuthenticatedApplicationUser> {
  const values = userFromGitHubUser(gitHubUser);

  if (!(await usernameIsAvailable(values.username))) {
    throw new Error(
      `Dev GitHub auth bypass: username "${values.username}" already exists and is not linked to this GitHub account.`,
    );
  }

  const [created] = await db.insert(userTable).values(values).returning(userColumns);
  if (!created) {
    throw new Error('Dev GitHub auth bypass: failed to create the local GitHub bypass user.');
  }

  return created;
}

async function resolveApplicationUser(
  gitHubUser: GitHubUserResponse,
): Promise<AuthenticatedApplicationUser> {
  const providerUserId = String(gitHubUser.id);
  const neonAuthUserId = `dev-github:${providerUserId}`;

  const connectionUser = await findUserByGitHubConnection(providerUserId);
  if (connectionUser) return updateUserFromGitHub(connectionUser, gitHubUser);

  const installationOwner = await findInstallationOwner(gitHubUser.id);
  if (installationOwner) return updateUserFromGitHub(installationOwner, gitHubUser);

  const existingDevUser = await findUserByNeonAuthUserId(neonAuthUserId);
  if (existingDevUser) return updateUserFromGitHub(existingDevUser, gitHubUser);

  return createDevGitHubUser(gitHubUser);
}

export async function resolveDevGitHubBypassSession(): Promise<DevGitHubBypassSession> {
  if (cachedSession) return cachedSession;

  const token = resolveGitHubToken();
  const { user: gitHubUser, scope } = await fetchGitHubUser(token);
  const user = await resolveApplicationUser(gitHubUser);

  if (await tokenCanListUserInstallations(token)) {
    await upsertOAuthConnection(user.id, 'github', {
      providerUserId: String(gitHubUser.id),
      accessToken: token,
      refreshToken: null,
      expiresAt: null,
      scope,
    });
  } else {
    await deleteOAuthConnection(user.id, 'github');
  }

  cachedSession = {
    user,
    neonSession: {
      neonAuthUserId: `dev-github:${gitHubUser.id}`,
      expiresAt: new Date('2999-01-01T00:00:00.000Z'),
    },
  };

  return cachedSession;
}
