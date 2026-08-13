import { bigint, index, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { githubInstallationStatusEnum, syncStatusEnum } from './enums';
import { user } from './user';

/**
 * GitHub App installations.
 * Each row represents a GitHub App installed on a GitHub account (user/org),
 * bound to the Tribunal user who connected it.
 */
export const githubInstallation = pgTable(
  'github_installation',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),

    // GitHub's installation ID (unique globally, natural key)
    installationId: bigint('installation_id', { mode: 'number' }).notNull().unique(),

    // The Tribunal user who connected this installation.
    userId: integer('user_id').references(() => user.id, { onDelete: 'cascade' }),

    // GitHub account info
    accountLogin: text('account_login').notNull(),
    accountId: bigint('account_id', { mode: 'number' }).notNull(),
    accountAvatarUrl: text('account_avatar_url'),

    // Status tracking
    status: githubInstallationStatusEnum('status').notNull().default('active'),

    // Sync tracking
    syncStatus: syncStatusEnum('sync_status').notNull().default('idle'),
    syncStartedAt: timestamp('sync_started_at', { withTimezone: true }),
    syncWorkflowExecutionToken: text('sync_workflow_execution_token'),
    syncActivityAttemptToken: text('sync_activity_attempt_token'),
  },
  (table) => [
    index('github_installation_status_idx').on(table.status),
    index('github_installation_user_idx').on(table.userId),
  ],
);

export type GitHubInstallation = typeof githubInstallation.$inferSelect;
export type NewGitHubInstallation = typeof githubInstallation.$inferInsert;
