/**
 * GitHub installation factory for creating test GitHub App installations.
 */
import { githubInstallation } from '@tribunal/database/schema';
import type { GitHubInstallation } from '@tribunal/database/schema';
import type { Database } from './core';
import { generateId } from './core';

export type GitHubInstallationFactoryInput = Partial<{
  installationId: number;
  accountLogin: string;
  accountId: number;
  status: 'active' | 'suspended' | 'needs_permissions' | 'error';
  /** Tribunal user the installation is bound to. */
  userId: number;
}>;

export interface GitHubInstallationFactory {
  /** Create a GitHub App installation, optionally bound to a user. */
  create(input?: GitHubInstallationFactoryInput): Promise<GitHubInstallation>;
  /** Create an installation already bound to a user. */
  createForUser(
    userId: number,
    input?: GitHubInstallationFactoryInput,
  ): Promise<GitHubInstallation>;
}

export function createGitHubInstallationFactory(db: Database): GitHubInstallationFactory {
  return {
    async create(input = {}) {
      const id = generateId();
      const [installation] = await db
        .insert(githubInstallation)
        .values({
          installationId: input.installationId ?? 1000000 + id,
          accountLogin: input.accountLogin ?? `test-org-${id}`,
          accountId: input.accountId ?? 2000000 + id,
          status: input.status ?? 'active',
          userId: input.userId,
        })
        .returning();
      return installation;
    },

    async createForUser(userId, input = {}) {
      return this.create({ ...input, userId });
    },
  };
}
