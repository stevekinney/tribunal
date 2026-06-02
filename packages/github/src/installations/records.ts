/**
 * Installation record management.
 *
 * CRUD operations for GitHub App installation records: create, read,
 * update status, sync tracking, and deletion.
 */

import { eq } from 'drizzle-orm';
import {
  githubInstallation,
  type GitHubAccountType,
  type GitHubInstallation,
  type GitHubInstallationStatus,
  type RepositorySelection,
} from '@tribunal/database/schema';
import type { GithubServiceContext } from '../context.js';

// Valid GitHub account types - validate against this to prevent enum errors
const VALID_ACCOUNT_TYPES: readonly GitHubAccountType[] = ['User', 'Organization'];

export interface UpsertInstallationData {
  installationId: number;
  accountLogin: string;
  accountType: GitHubAccountType;
  accountId: number;
  accountAvatarUrl?: string | null;
  repositorySelection: RepositorySelection;
  /** Tribunal user the installation is bound to. Omitted for webhook stub creates. */
  userId?: number;
}

/**
 * Create or update a GitHub installation record.
 * When `userId` is provided, binds the installation to that user.
 */
export async function upsertInstallation(
  context: GithubServiceContext,
  data: UpsertInstallationData,
): Promise<void> {
  // Validate account type to prevent enum errors
  const accountType: GitHubAccountType = VALID_ACCOUNT_TYPES.includes(data.accountType)
    ? data.accountType
    : 'Organization'; // Safe default

  await context.db
    .insert(githubInstallation)
    .values({
      installationId: data.installationId,
      accountLogin: data.accountLogin,
      accountType,
      accountId: data.accountId,
      accountAvatarUrl: data.accountAvatarUrl,
      repositorySelection: data.repositorySelection,
      userId: data.userId,
      status: 'active',
    })
    .onConflictDoUpdate({
      target: githubInstallation.installationId,
      set: {
        accountLogin: data.accountLogin,
        accountType,
        accountAvatarUrl: data.accountAvatarUrl,
        repositorySelection: data.repositorySelection,
        // Only overwrite the binding when an owner is supplied; webhook
        // stub upserts (no userId) must not clear an existing binding.
        ...(data.userId !== undefined ? { userId: data.userId } : {}),
        status: 'active',
        statusReason: null,
        updatedAt: new Date(),
      },
    });
}

/**
 * Get installation by GitHub's installation ID.
 */
export async function getInstallationById(context: GithubServiceContext, installationId: number) {
  const [installation] = await context.db
    .select()
    .from(githubInstallation)
    .where(eq(githubInstallation.installationId, installationId));
  return installation ?? null;
}

/**
 * Installation binding status - describes the relationship between
 * a GitHub installation and our database records.
 */
export type InstallationBindingStatus =
  | { status: 'unbound'; installationExists: false }
  | { status: 'orphan'; installationExists: true; installation: GitHubInstallation }
  | {
      status: 'bound';
      installationExists: true;
      installation: GitHubInstallation;
      userId: number;
    };

/**
 * Get the full binding status of an installation.
 * Returns whether the installation record exists and if it's bound to a user.
 *
 * Possible states:
 * - unbound: No installation record exists (fresh install)
 * - orphan: Installation record exists but no user binding (partial failure / direct install)
 * - bound: Installation record exists and is bound to a user
 */
export async function getInstallationBindingStatus(
  context: GithubServiceContext,
  installationId: number,
): Promise<InstallationBindingStatus> {
  // First check if installation record exists
  const installation = await getInstallationById(context, installationId);

  if (!installation) {
    return { status: 'unbound', installationExists: false };
  }

  if (installation.userId === null) {
    return { status: 'orphan', installationExists: true, installation };
  }

  return {
    status: 'bound',
    installationExists: true,
    installation,
    userId: installation.userId,
  };
}

/**
 * Delete installation record and all related data.
 * Called when GitHub sends installation.deleted webhook.
 */
export async function deleteInstallation(
  context: GithubServiceContext,
  installationId: number,
): Promise<void> {
  // Cascade delete handles github_installation_repository
  await context.db
    .delete(githubInstallation)
    .where(eq(githubInstallation.installationId, installationId));
}

/**
 * Update installation status.
 */
export async function updateInstallationStatus(
  context: GithubServiceContext,
  installationId: number,
  status: GitHubInstallationStatus,
  reason?: string,
): Promise<void> {
  await context.db
    .update(githubInstallation)
    .set({
      status,
      statusReason: reason ?? null,
      updatedAt: new Date(),
    })
    .where(eq(githubInstallation.installationId, installationId));
}
