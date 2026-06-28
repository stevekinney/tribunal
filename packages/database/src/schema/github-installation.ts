import { bigint, index, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import {
  githubAccountTypeEnum,
  githubInstallationStatusEnum,
  repositorySelectionEnum,
  syncStatusEnum,
} from './enums';
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
    accountType: githubAccountTypeEnum('account_type').notNull(),
    accountId: bigint('account_id', { mode: 'number' }).notNull(),
    accountAvatarUrl: text('account_avatar_url'),

    // Installation configuration
    repositorySelection: repositorySelectionEnum('repository_selection').notNull(),

    // Status tracking
    status: githubInstallationStatusEnum('status').notNull().default('active'),
    statusReason: text('status_reason'),

    // Sync tracking
    lastSyncedAt: timestamp('last_synced_at'),
    syncStatus: syncStatusEnum('sync_status').notNull().default('idle'),
    syncError: text('sync_error'),
    syncWorkflowExecutionToken: text('sync_workflow_execution_token'),
    syncActivityAttemptToken: text('sync_activity_attempt_token'),

    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('github_installation_status_idx').on(table.status),
    index('github_installation_user_idx').on(table.userId),
  ],
);

export type GitHubInstallation = typeof githubInstallation.$inferSelect;
export type NewGitHubInstallation = typeof githubInstallation.$inferInsert;
