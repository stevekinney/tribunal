/**
 * User-installation binding management.
 *
 * Binds GitHub App installations directly to the Tribunal user who
 * connected them. The binding is stored on the `github_installation`
 * record via its `userId` column (no join table).
 */

import { and, eq } from 'drizzle-orm';
import {
  githubInstallation,
  user,
  type GitHubAccountType,
  type GitHubInstallationStatus,
  type RepositorySelection,
  type SyncStatus,
} from '@tribunal/database/schema';
import type { GithubServiceContext } from '../context.js';

export interface ConnectInstallationParams {
  userId: number;
  installationId: number;
}

/**
 * Bind a GitHub installation to a user.
 * Idempotent: re-binding an existing installation updates its owner.
 */
export async function connectInstallationToUser(
  context: GithubServiceContext,
  params: ConnectInstallationParams,
): Promise<{ success: true }> {
  await context.db
    .update(githubInstallation)
    .set({ userId: params.userId, updatedAt: new Date() })
    .where(eq(githubInstallation.installationId, params.installationId));
  return { success: true };
}

/**
 * Check if an installation is bound to a specific user.
 */
export async function isInstallationOwnedByUser(
  context: GithubServiceContext,
  installationId: number,
  userId: number,
): Promise<boolean> {
  const [result] = await context.db
    .select({ id: githubInstallation.id })
    .from(githubInstallation)
    .where(
      and(
        eq(githubInstallation.installationId, installationId),
        eq(githubInstallation.userId, userId),
      ),
    )
    .limit(1);

  return !!result;
}

export interface UserInstallation {
  id: number;
  installationId: number;
  accountLogin: string;
  accountType: GitHubAccountType;
  accountAvatarUrl: string | null;
  repositorySelection: RepositorySelection;
  status: GitHubInstallationStatus;
  statusReason: string | null;
  lastSyncedAt: Date | null;
  syncStatus: SyncStatus;
  syncError: string | null;
  connectedBy: {
    id: number;
    username: string;
    avatarUrl: string | null;
  } | null;
}

/**
 * List all GitHub installations bound to a user.
 */
export async function getInstallationsForUser(
  context: GithubServiceContext,
  userId: number,
): Promise<UserInstallation[]> {
  const results = await context.db
    .select({
      id: githubInstallation.id,
      installationId: githubInstallation.installationId,
      accountLogin: githubInstallation.accountLogin,
      accountType: githubInstallation.accountType,
      accountAvatarUrl: githubInstallation.accountAvatarUrl,
      repositorySelection: githubInstallation.repositorySelection,
      status: githubInstallation.status,
      statusReason: githubInstallation.statusReason,
      lastSyncedAt: githubInstallation.lastSyncedAt,
      syncStatus: githubInstallation.syncStatus,
      syncError: githubInstallation.syncError,
      ownerUserId: githubInstallation.userId,
      ownerUsername: user.username,
      ownerAvatarUrl: user.avatarUrl,
    })
    .from(githubInstallation)
    .leftJoin(user, eq(githubInstallation.userId, user.id))
    .where(eq(githubInstallation.userId, userId));

  return results.map((row) => ({
    id: row.id,
    installationId: row.installationId,
    accountLogin: row.accountLogin,
    accountType: row.accountType,
    accountAvatarUrl: row.accountAvatarUrl,
    repositorySelection: row.repositorySelection,
    status: row.status,
    statusReason: row.statusReason,
    lastSyncedAt: row.lastSyncedAt,
    syncStatus: row.syncStatus,
    syncError: row.syncError,
    connectedBy:
      row.ownerUserId && row.ownerUsername
        ? {
            id: row.ownerUserId,
            username: row.ownerUsername,
            avatarUrl: row.ownerAvatarUrl,
          }
        : null,
  }));
}

/**
 * Get the user id an installation is bound to, or null if unbound.
 */
export async function getUserForInstallation(
  context: GithubServiceContext,
  installationId: number,
): Promise<number | null> {
  const [row] = await context.db
    .select({ userId: githubInstallation.userId })
    .from(githubInstallation)
    .where(eq(githubInstallation.installationId, installationId))
    .limit(1);

  return row?.userId ?? null;
}
