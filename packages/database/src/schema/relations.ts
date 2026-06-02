import { relations } from 'drizzle-orm';

// Import all tables
import { authAccount } from './auth-account';
import { githubInstallation } from './github-installation';
import { githubInstallationRepository } from './github-installation-repository';
import { repository } from './repository';
import { session } from './session';
import { user } from './user';
import { userApiKey } from './user-api-key';
import { webhookEvent } from './webhook-event';
import { workflowRun } from './workflow-run';

// ============================================================================
// RELATIONS
// ============================================================================

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  authAccounts: many(authAccount),
  apiKeys: many(userApiKey),
  githubInstallations: many(githubInstallation),
}));

export const userApiKeyRelations = relations(userApiKey, ({ one }) => ({
  user: one(user, { fields: [userApiKey.userId], references: [user.id] }),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, { fields: [session.userId], references: [user.id] }),
}));

export const repositoryRelations = relations(repository, ({ many }) => ({
  webhookEvents: many(webhookEvent),
  installationLinks: many(githubInstallationRepository),
}));

export const githubInstallationRelations = relations(githubInstallation, ({ one, many }) => ({
  user: one(user, {
    fields: [githubInstallation.userId],
    references: [user.id],
  }),
  repositories: many(githubInstallationRepository),
}));

export const githubInstallationRepositoryRelations = relations(
  githubInstallationRepository,
  ({ one }) => ({
    installation: one(githubInstallation, {
      fields: [githubInstallationRepository.installationId],
      references: [githubInstallation.installationId],
    }),
    repository: one(repository, {
      fields: [githubInstallationRepository.repositoryId],
      references: [repository.id],
    }),
  }),
);

export const webhookEventRelations = relations(webhookEvent, ({ one }) => ({
  repository: one(repository, { fields: [webhookEvent.repositoryId], references: [repository.id] }),
}));

export const authAccountRelations = relations(authAccount, ({ one }) => ({
  user: one(user, { fields: [authAccount.userId], references: [user.id] }),
}));

export const workflowRunRelations = relations(workflowRun, ({ one }) => ({
  repository: one(repository, {
    fields: [workflowRun.repositoryId],
    references: [repository.id],
  }),
}));
