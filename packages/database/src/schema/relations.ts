import { relations } from 'drizzle-orm';

import { agent } from './agent';
import { agentEvent } from './agent-event';
import { agentRun } from './agent-run';
import { costEvent } from './cost-event';
import { finding } from './finding';
import { githubInstallation } from './github-installation';
import { githubInstallationRepository } from './github-installation-repository';
import { repository } from './repository';
import { repositoryAgent } from './repository-agent';
import { repositoryReviewSettings } from './repository-review-settings';
import { reviewIntent } from './review-intent';
import { reviewRun } from './review-run';
import { user } from './user';
import { userApiKey } from './user-api-key';
import { userReviewSettings } from './user-review-settings';
import { webhookEvent } from './webhook-event';
import { workflowRun } from './workflow-run';

// ============================================================================
// RELATIONS
// ============================================================================

export const userRelations = relations(user, ({ many }) => ({
  apiKeys: many(userApiKey),
  agents: many(agent),
  costEvents: many(costEvent),
  githubInstallations: many(githubInstallation),
  reviewRuns: many(reviewRun),
}));

export const userApiKeyRelations = relations(userApiKey, ({ one }) => ({
  user: one(user, { fields: [userApiKey.userId], references: [user.id] }),
}));

export const repositoryRelations = relations(repository, ({ many }) => ({
  webhookEvents: many(webhookEvent),
  installationLinks: many(githubInstallationRepository),
  reviewRuns: many(reviewRun),
  reviewIntents: many(reviewIntent),
  costEvents: many(costEvent),
  assignedAgents: many(repositoryAgent),
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

export const workflowRunRelations = relations(workflowRun, ({ one }) => ({
  repository: one(repository, {
    fields: [workflowRun.repositoryId],
    references: [repository.id],
  }),
}));

export const agentRelations = relations(agent, ({ one, many }) => ({
  user: one(user, { fields: [agent.userId], references: [user.id] }),
  repositoryAssignments: many(repositoryAgent),
  runs: many(agentRun),
  costEvents: many(costEvent),
}));

export const repositoryAgentRelations = relations(repositoryAgent, ({ one }) => ({
  repository: one(repository, {
    fields: [repositoryAgent.repositoryId],
    references: [repository.id],
  }),
  agent: one(agent, { fields: [repositoryAgent.agentId], references: [agent.id] }),
}));

export const repositoryReviewSettingsRelations = relations(repositoryReviewSettings, ({ one }) => ({
  repository: one(repository, {
    fields: [repositoryReviewSettings.repositoryId],
    references: [repository.id],
  }),
}));

export const userReviewSettingsRelations = relations(userReviewSettings, ({ one }) => ({
  user: one(user, { fields: [userReviewSettings.userId], references: [user.id] }),
}));

export const reviewRunRelations = relations(reviewRun, ({ one, many }) => ({
  user: one(user, { fields: [reviewRun.userId], references: [user.id] }),
  repository: one(repository, { fields: [reviewRun.repositoryId], references: [repository.id] }),
  agentRuns: many(agentRun),
  costEvents: many(costEvent),
}));

export const agentRunRelations = relations(agentRun, ({ one, many }) => ({
  user: one(user, { fields: [agentRun.userId], references: [user.id] }),
  reviewRun: one(reviewRun, { fields: [agentRun.reviewRunId], references: [reviewRun.id] }),
  agent: one(agent, { fields: [agentRun.agentId], references: [agent.id] }),
  findings: many(finding),
  events: many(agentEvent),
  costEvents: many(costEvent),
}));

export const findingRelations = relations(finding, ({ one }) => ({
  user: one(user, { fields: [finding.userId], references: [user.id] }),
  agentRun: one(agentRun, { fields: [finding.agentRunId], references: [agentRun.id] }),
}));

export const agentEventRelations = relations(agentEvent, ({ one }) => ({
  agentRun: one(agentRun, { fields: [agentEvent.agentRunId], references: [agentRun.id] }),
}));

export const reviewIntentRelations = relations(reviewIntent, ({ one }) => ({
  repository: one(repository, { fields: [reviewIntent.repositoryId], references: [repository.id] }),
}));

export const costEventRelations = relations(costEvent, ({ one }) => ({
  user: one(user, { fields: [costEvent.userId], references: [user.id] }),
  repository: one(repository, { fields: [costEvent.repositoryId], references: [repository.id] }),
  reviewRun: one(reviewRun, { fields: [costEvent.reviewRunId], references: [reviewRun.id] }),
  agentRun: one(agentRun, { fields: [costEvent.agentRunId], references: [agentRun.id] }),
  agent: one(agent, { fields: [costEvent.agentId], references: [agent.id] }),
}));
