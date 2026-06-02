import {
  bigint,
  boolean,
  index,
  integer,
  pgTable,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { githubInstallation } from './github-installation';
import { repository } from './repository';

/**
 * Repositories accessible via a GitHub installation.
 * Populated by webhook events and sync jobs.
 *
 * Note: The `repository` table stores repo identity (id, owner, name).
 * This table tracks which repos are accessible via which installation.
 */
export const githubInstallationRepository = pgTable(
  'github_installation_repository',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),

    installationId: bigint('installation_id', { mode: 'number' })
      .notNull()
      .references(() => githubInstallation.installationId, { onDelete: 'cascade' }),

    repositoryId: bigint('repository_id', { mode: 'number' })
      .notNull()
      .references(() => repository.id, { onDelete: 'cascade' }),

    // Whether this repo is currently accessible (false if removed from installation)
    isActive: boolean('is_active').notNull().default(true),

    addedAt: timestamp('added_at').notNull().defaultNow(),
    removedAt: timestamp('removed_at'),
  },
  (table) => [
    // Each repo can only be linked to one installation once
    uniqueIndex('github_installation_repository_unique').on(
      table.installationId,
      table.repositoryId,
    ),
    index('github_installation_repository_installation_idx').on(table.installationId),
    index('github_installation_repository_repository_idx').on(table.repositoryId),
  ],
);

export type GitHubInstallationRepository = typeof githubInstallationRepository.$inferSelect;
export type NewGitHubInstallationRepository = typeof githubInstallationRepository.$inferInsert;
