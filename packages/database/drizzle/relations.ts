import { relations } from 'drizzle-orm/relations';
import {
  workspace,
  project,
  user,
  oauthConnection,
  serviceKey,
  serviceAuditLog,
  serviceAccount,
  session,
  repository,
  webhookEvent,
  githubInstallationRepository,
  githubInstallation,
  workspaceGithubInstallation,
  workspaceMembership,
  goal,
  answer,
  answerVersion,
  question,
  authAccount,
  workspaceIntegration,
  integrationCredential,
  integrationAuditLog,
  workspaceIntegrationResource,
  goalVersion,
  linearWebhook,
  prd,
  technicalSpec,
  linearIssue,
  linearTeam,
  linearProject,
  linearProjectRepoMapping,
  linearComment,
  linearLabel,
  projectLinearSettings,
  userApiKey,
  linearWebhookDelivery,
  platformAdminAuditLog,
  workflowConfig,
  workflowRun,
  pullRequestTrigger,
  workflowIssueReference,
  pipelineRun,
  claudeSession,
  draftVersion,
  pipeline,
  phaseExecution,
  pipelineOutputSchema,
  pipelineArtifact,
  analysisContext,
  pullRequestState,
  analysisCapability,
  analysisArchitecture,
  analysisArchitectureVersion,
  analysisConnectedRepo,
  analysisConnectedRepoVersion,
  analysisContextArtifact,
  analysisDependency,
  analysisDeploymentContext,
  analysisDeploymentContextVersion,
  analysisDiagram,
  analysisCapabilityVersion,
  analysisDependencyVersion,
  analysisExternalIntegration,
  analysisExternalIntegrationVersion,
  analysisFeature,
  analysisFeatureVersion,
  analysisIntraDependency,
  analysisLayer,
  analysisDiagramVersion,
  analysisEtiquette,
  analysisEtiquetteVersion,
  analysisIntraDependencyVersion,
  analysisLayerVersion,
  analysisProjectSummary,
  analysisProjectSummaryVersion,
  analysisSetup,
  analysisSetupVersion,
  analysisUx,
  analysisUxVersion,
  sessionEvent,
  flow,
  task,
  plan,
  projectAnalysis,
  sandboxLifecycleEvent,
  sandboxLifecycleSnapshot,
  sandboxWorkflowMapping,
  pullRequestActionItem,
  pullRequestActionItemSource,
  repositorySandboxSession,
  repositorySandboxTerminalEvent,
  workspaceInviteLink,
  workspaceInviteLinkUse,
  template,
  goalLayer,
  goalCapability,
  goalConnection,
  goalFeature,
  taskDependency,
  pullRequestActionItemDependency,
  projectRepository,
  linearIssueLabel,
  analysisRunRepository,
  projectReviewAgent,
  projectReviewAgentPattern,
  projectReviewAgentRepository,
  projectReviewAgentRun,
} from './schema';

export const projectRelations = relations(project, ({ one, many }) => ({
  workspace: one(workspace, {
    fields: [project.workspaceId],
    references: [workspace.id],
  }),
  goals: many(goal),
  questions: many(question),
  linearIssues: many(linearIssue),
  linearTeams: many(linearTeam),
  linearProjectRepoMappings: many(linearProjectRepoMapping),
  linearProjects: many(linearProject),
  linearComments: many(linearComment),
  linearLabels: many(linearLabel),
  projectLinearSettings: many(projectLinearSettings),
  analysisContexts: many(analysisContext),
  analysisCapabilities: many(analysisCapability),
  analysisArchitectures: many(analysisArchitecture),
  analysisConnectedRepos: many(analysisConnectedRepo),
  analysisContextArtifacts: many(analysisContextArtifact),
  analysisDependencies: many(analysisDependency),
  analysisDeploymentContexts: many(analysisDeploymentContext),
  analysisDiagrams: many(analysisDiagram),
  analysisExternalIntegrations: many(analysisExternalIntegration),
  analysisFeatures: many(analysisFeature),
  analysisIntraDependencies: many(analysisIntraDependency),
  analysisLayers: many(analysisLayer),
  analysisEtiquettes: many(analysisEtiquette),
  analysisProjectSummaries: many(analysisProjectSummary),
  analysisSetups: many(analysisSetup),
  analysisUxes: many(analysisUx),
  sessionEvents: many(sessionEvent),
  prds: many(prd),
  technicalSpecs: many(technicalSpec),
  plans: many(plan),
  projectAnalyses: many(projectAnalysis),
  sandboxLifecycleEvents: many(sandboxLifecycleEvent),
  sandboxLifecycleSnapshots: many(sandboxLifecycleSnapshot),
  sandboxWorkflowMappings: many(sandboxWorkflowMapping),
  repositorySandboxSessions: many(repositorySandboxSession),
  projectRepositories: many(projectRepository),
}));

export const workspaceRelations = relations(workspace, ({ many }) => ({
  projects: many(project),
  workspaceGithubInstallations: many(workspaceGithubInstallation),
  workspaceMemberships: many(workspaceMembership),
  goals: many(goal),
  integrationAuditLogs: many(integrationAuditLog),
  workspaceIntegrations: many(workspaceIntegration),
  questions: many(question),
  workflowConfigs: many(workflowConfig),
  workflowRuns: many(workflowRun),
  pullRequestTriggers: many(pullRequestTrigger),
  analysisCapabilities: many(analysisCapability),
  analysisArchitectures: many(analysisArchitecture),
  analysisConnectedRepos: many(analysisConnectedRepo),
  analysisContextArtifacts: many(analysisContextArtifact),
  analysisDependencies: many(analysisDependency),
  analysisDeploymentContexts: many(analysisDeploymentContext),
  analysisDiagrams: many(analysisDiagram),
  analysisExternalIntegrations: many(analysisExternalIntegration),
  analysisFeatures: many(analysisFeature),
  analysisIntraDependencies: many(analysisIntraDependency),
  analysisLayers: many(analysisLayer),
  analysisEtiquettes: many(analysisEtiquette),
  analysisProjectSummaries: many(analysisProjectSummary),
  analysisSetups: many(analysisSetup),
  analysisUxes: many(analysisUx),
  sessionEvents: many(sessionEvent),
  flows: many(flow),
  prds: many(prd),
  technicalSpecs: many(technicalSpec),
  tasks: many(task),
  sandboxLifecycleEvents: many(sandboxLifecycleEvent),
  sandboxLifecycleSnapshots: many(sandboxLifecycleSnapshot),
  sandboxWorkflowMappings: many(sandboxWorkflowMapping),
  repositorySandboxSessions: many(repositorySandboxSession),
  workspaceInviteLinks: many(workspaceInviteLink),
  templates: many(template),
}));

export const oauthConnectionRelations = relations(oauthConnection, ({ one }) => ({
  user: one(user, {
    fields: [oauthConnection.userId],
    references: [user.id],
  }),
}));

export const userRelations = relations(user, ({ many }) => ({
  oauthConnections: many(oauthConnection),
  sessions: many(session),
  workspaceGithubInstallations: many(workspaceGithubInstallation),
  workspaceMemberships: many(workspaceMembership),
  goals: many(goal),
  answerVersions: many(answerVersion),
  answers: many(answer),
  authAccounts: many(authAccount),
  integrationAuditLogs: many(integrationAuditLog),
  workspaceIntegrations: many(workspaceIntegration),
  goalVersions: many(goalVersion),
  questions: many(question),
  userApiKeys: many(userApiKey),
  platformAdminAuditLogs_userId: many(platformAdminAuditLog, {
    relationName: 'platformAdminAuditLog_userId_user_id',
  }),
  platformAdminAuditLogs_performedBy: many(platformAdminAuditLog, {
    relationName: 'platformAdminAuditLog_performedBy_user_id',
  }),
  workflowRuns: many(workflowRun),
  prds: many(prd),
  technicalSpecs: many(technicalSpec),
  tasks: many(task),
  sandboxLifecycleEvents: many(sandboxLifecycleEvent),
  sandboxLifecycleSnapshots: many(sandboxLifecycleSnapshot),
  repositorySandboxSessions: many(repositorySandboxSession),
  workspaceInviteLinks: many(workspaceInviteLink),
  workspaceInviteLinkUses: many(workspaceInviteLinkUse),
}));

export const serviceAuditLogRelations = relations(serviceAuditLog, ({ one }) => ({
  serviceKey: one(serviceKey, {
    fields: [serviceAuditLog.serviceKeyId],
    references: [serviceKey.id],
  }),
  serviceAccount: one(serviceAccount, {
    fields: [serviceAuditLog.serviceAccountId],
    references: [serviceAccount.id],
  }),
}));

export const serviceKeyRelations = relations(serviceKey, ({ one, many }) => ({
  serviceAuditLogs: many(serviceAuditLog),
  serviceAccount: one(serviceAccount, {
    fields: [serviceKey.serviceAccountId],
    references: [serviceAccount.id],
  }),
}));

export const serviceAccountRelations = relations(serviceAccount, ({ many }) => ({
  serviceAuditLogs: many(serviceAuditLog),
  serviceKeys: many(serviceKey),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, {
    fields: [session.userId],
    references: [user.id],
  }),
}));

export const webhookEventRelations = relations(webhookEvent, ({ one }) => ({
  repository: one(repository, {
    fields: [webhookEvent.repositoryId],
    references: [repository.id],
  }),
}));

export const repositoryRelations = relations(repository, ({ many }) => ({
  webhookEvents: many(webhookEvent),
  githubInstallationRepositories: many(githubInstallationRepository),
  goals: many(goal),
  questions: many(question),
  linearProjectRepoMappings: many(linearProjectRepoMapping),
  workflowRuns: many(workflowRun),
  pullRequestTriggers: many(pullRequestTrigger),
  pullRequestStates: many(pullRequestState),
  prds: many(prd),
  technicalSpecs: many(technicalSpec),
  sandboxLifecycleEvents: many(sandboxLifecycleEvent),
  sandboxLifecycleSnapshots: many(sandboxLifecycleSnapshot),
  sandboxWorkflowMappings: many(sandboxWorkflowMapping),
  repositorySandboxSessions: many(repositorySandboxSession),
  projectRepositories: many(projectRepository),
}));

export const githubInstallationRepositoryRelations = relations(
  githubInstallationRepository,
  ({ one }) => ({
    repository: one(repository, {
      fields: [githubInstallationRepository.repositoryId],
      references: [repository.id],
    }),
    githubInstallation: one(githubInstallation, {
      fields: [githubInstallationRepository.installationId],
      references: [githubInstallation.installationId],
    }),
  }),
);

export const githubInstallationRelations = relations(githubInstallation, ({ many }) => ({
  githubInstallationRepositories: many(githubInstallationRepository),
  workspaceGithubInstallations: many(workspaceGithubInstallation),
  pullRequestTriggers: many(pullRequestTrigger),
}));

export const workspaceGithubInstallationRelations = relations(
  workspaceGithubInstallation,
  ({ one }) => ({
    workspace: one(workspace, {
      fields: [workspaceGithubInstallation.workspaceId],
      references: [workspace.id],
    }),
    user: one(user, {
      fields: [workspaceGithubInstallation.connectedByUserId],
      references: [user.id],
    }),
    githubInstallation: one(githubInstallation, {
      fields: [workspaceGithubInstallation.installationId],
      references: [githubInstallation.installationId],
    }),
  }),
);

export const workspaceMembershipRelations = relations(workspaceMembership, ({ one }) => ({
  workspace: one(workspace, {
    fields: [workspaceMembership.workspaceId],
    references: [workspace.id],
  }),
  user: one(user, {
    fields: [workspaceMembership.userId],
    references: [user.id],
  }),
}));

export const goalRelations = relations(goal, ({ one, many }) => ({
  workspace: one(workspace, {
    fields: [goal.workspaceId],
    references: [workspace.id],
  }),
  project: one(project, {
    fields: [goal.projectId],
    references: [project.id],
  }),
  repository: one(repository, {
    fields: [goal.repositoryId],
    references: [repository.id],
  }),
  goal: one(goal, {
    fields: [goal.parentGoalId],
    references: [goal.id],
    relationName: 'goal_parentGoalId_goal_id',
  }),
  goals: many(goal, {
    relationName: 'goal_parentGoalId_goal_id',
  }),
  user: one(user, {
    fields: [goal.createdByUserId],
    references: [user.id],
  }),
  goalVersions: many(goalVersion),
  questions: many(question),
  prds: many(prd),
  plans: many(plan),
  sandboxLifecycleEvents: many(sandboxLifecycleEvent),
  sandboxLifecycleSnapshots: many(sandboxLifecycleSnapshot),
  goalLayers: many(goalLayer),
  goalCapabilities: many(goalCapability),
  goalConnections_goalId: many(goalConnection, {
    relationName: 'goalConnection_goalId_goal_id',
  }),
  goalConnections_connectedGoalId: many(goalConnection, {
    relationName: 'goalConnection_connectedGoalId_goal_id',
  }),
  goalFeatures: many(goalFeature),
}));

export const answerVersionRelations = relations(answerVersion, ({ one }) => ({
  answer: one(answer, {
    fields: [answerVersion.answerId],
    references: [answer.id],
  }),
  question: one(question, {
    fields: [answerVersion.questionId],
    references: [question.id],
  }),
  user: one(user, {
    fields: [answerVersion.createdByUserId],
    references: [user.id],
  }),
}));

export const answerRelations = relations(answer, ({ one, many }) => ({
  answerVersions: many(answerVersion),
  question: one(question, {
    fields: [answer.questionId],
    references: [question.id],
  }),
  user: one(user, {
    fields: [answer.createdByUserId],
    references: [user.id],
  }),
}));

export const questionRelations = relations(question, ({ one, many }) => ({
  answerVersions: many(answerVersion),
  answers: many(answer),
  prd: one(prd, {
    fields: [question.prdId],
    references: [prd.id],
  }),
  technicalSpec: one(technicalSpec, {
    fields: [question.technicalSpecId],
    references: [technicalSpec.id],
  }),
  workspace: one(workspace, {
    fields: [question.workspaceId],
    references: [workspace.id],
  }),
  project: one(project, {
    fields: [question.projectId],
    references: [project.id],
  }),
  repository: one(repository, {
    fields: [question.repositoryId],
    references: [repository.id],
  }),
  goal: one(goal, {
    fields: [question.goalId],
    references: [goal.id],
  }),
  user: one(user, {
    fields: [question.createdByUserId],
    references: [user.id],
  }),
}));

export const authAccountRelations = relations(authAccount, ({ one }) => ({
  user: one(user, {
    fields: [authAccount.userId],
    references: [user.id],
  }),
}));

export const integrationCredentialRelations = relations(integrationCredential, ({ one }) => ({
  workspaceIntegration: one(workspaceIntegration, {
    fields: [integrationCredential.workspaceIntegrationId],
    references: [workspaceIntegration.id],
  }),
}));

export const workspaceIntegrationRelations = relations(workspaceIntegration, ({ one, many }) => ({
  integrationCredentials: many(integrationCredential),
  workspace: one(workspace, {
    fields: [workspaceIntegration.workspaceId],
    references: [workspace.id],
  }),
  user: one(user, {
    fields: [workspaceIntegration.connectedByUserId],
    references: [user.id],
  }),
  workspaceIntegrationResources: many(workspaceIntegrationResource),
  linearWebhooks: many(linearWebhook),
  linearWebhookDeliveries: many(linearWebhookDelivery),
}));

export const integrationAuditLogRelations = relations(integrationAuditLog, ({ one }) => ({
  workspace: one(workspace, {
    fields: [integrationAuditLog.workspaceId],
    references: [workspace.id],
  }),
  user: one(user, {
    fields: [integrationAuditLog.actorUserId],
    references: [user.id],
  }),
}));

export const workspaceIntegrationResourceRelations = relations(
  workspaceIntegrationResource,
  ({ one }) => ({
    workspaceIntegration: one(workspaceIntegration, {
      fields: [workspaceIntegrationResource.workspaceIntegrationId],
      references: [workspaceIntegration.id],
    }),
  }),
);

export const goalVersionRelations = relations(goalVersion, ({ one }) => ({
  goal: one(goal, {
    fields: [goalVersion.goalId],
    references: [goal.id],
  }),
  user: one(user, {
    fields: [goalVersion.createdByUserId],
    references: [user.id],
  }),
}));

export const linearWebhookRelations = relations(linearWebhook, ({ one }) => ({
  workspaceIntegration: one(workspaceIntegration, {
    fields: [linearWebhook.workspaceIntegrationId],
    references: [workspaceIntegration.id],
  }),
}));

export const prdRelations = relations(prd, ({ one, many }) => ({
  questions: many(question),
  flows: many(flow),
  workspace: one(workspace, {
    fields: [prd.workspaceId],
    references: [workspace.id],
  }),
  project: one(project, {
    fields: [prd.projectId],
    references: [project.id],
  }),
  repository: one(repository, {
    fields: [prd.repositoryId],
    references: [repository.id],
  }),
  goal: one(goal, {
    fields: [prd.goalId],
    references: [goal.id],
  }),
  prd: one(prd, {
    fields: [prd.revisedFromPrdId],
    references: [prd.id],
    relationName: 'prd_revisedFromPrdId_prd_id',
  }),
  prds: many(prd, {
    relationName: 'prd_revisedFromPrdId_prd_id',
  }),
  analysisContextArtifact: one(analysisContextArtifact, {
    fields: [prd.artifactId],
    references: [analysisContextArtifact.id],
  }),
  user: one(user, {
    fields: [prd.createdByUserId],
    references: [user.id],
  }),
  technicalSpecs: many(technicalSpec),
}));

export const technicalSpecRelations = relations(technicalSpec, ({ one, many }) => ({
  questions: many(question),
  workspace: one(workspace, {
    fields: [technicalSpec.workspaceId],
    references: [workspace.id],
  }),
  project: one(project, {
    fields: [technicalSpec.projectId],
    references: [project.id],
  }),
  repository: one(repository, {
    fields: [technicalSpec.repositoryId],
    references: [repository.id],
  }),
  prd: one(prd, {
    fields: [technicalSpec.prdId],
    references: [prd.id],
  }),
  analysisContextArtifact: one(analysisContextArtifact, {
    fields: [technicalSpec.artifactId],
    references: [analysisContextArtifact.id],
  }),
  user: one(user, {
    fields: [technicalSpec.createdByUserId],
    references: [user.id],
  }),
  technicalSpec: one(technicalSpec, {
    fields: [technicalSpec.revisedFromTechnicalSpecId],
    references: [technicalSpec.id],
    relationName: 'technicalSpec_revisedFromTechnicalSpecId_technicalSpec_id',
  }),
  technicalSpecs: many(technicalSpec, {
    relationName: 'technicalSpec_revisedFromTechnicalSpecId_technicalSpec_id',
  }),
  tasks: many(task),
}));

export const linearIssueRelations = relations(linearIssue, ({ one, many }) => ({
  project: one(project, {
    fields: [linearIssue.projectId],
    references: [project.id],
  }),
  linearTeam: one(linearTeam, {
    fields: [linearIssue.teamId],
    references: [linearTeam.id],
  }),
  linearProject: one(linearProject, {
    fields: [linearIssue.linearProjectId],
    references: [linearProject.id],
  }),
  linearComments: many(linearComment),
  linearIssueLabels: many(linearIssueLabel),
}));

export const linearTeamRelations = relations(linearTeam, ({ one, many }) => ({
  linearIssues: many(linearIssue),
  project: one(project, {
    fields: [linearTeam.projectId],
    references: [project.id],
  }),
  linearProjects: many(linearProject),
  linearLabels: many(linearLabel),
}));

export const linearProjectRelations = relations(linearProject, ({ one, many }) => ({
  linearIssues: many(linearIssue),
  linearProjectRepoMappings: many(linearProjectRepoMapping),
  project: one(project, {
    fields: [linearProject.projectId],
    references: [project.id],
  }),
  linearTeam: one(linearTeam, {
    fields: [linearProject.teamId],
    references: [linearTeam.id],
  }),
}));

export const linearProjectRepoMappingRelations = relations(linearProjectRepoMapping, ({ one }) => ({
  project: one(project, {
    fields: [linearProjectRepoMapping.projectId],
    references: [project.id],
  }),
  repository: one(repository, {
    fields: [linearProjectRepoMapping.repositoryId],
    references: [repository.id],
  }),
  linearProject: one(linearProject, {
    fields: [linearProjectRepoMapping.linearProjectId],
    references: [linearProject.id],
  }),
}));

export const linearCommentRelations = relations(linearComment, ({ one }) => ({
  project: one(project, {
    fields: [linearComment.projectId],
    references: [project.id],
  }),
  linearIssue: one(linearIssue, {
    fields: [linearComment.issueId],
    references: [linearIssue.id],
  }),
}));

export const linearLabelRelations = relations(linearLabel, ({ one, many }) => ({
  project: one(project, {
    fields: [linearLabel.projectId],
    references: [project.id],
  }),
  linearTeam: one(linearTeam, {
    fields: [linearLabel.teamId],
    references: [linearTeam.id],
  }),
  linearIssueLabels: many(linearIssueLabel),
}));

export const projectLinearSettingsRelations = relations(projectLinearSettings, ({ one }) => ({
  project: one(project, {
    fields: [projectLinearSettings.projectId],
    references: [project.id],
  }),
}));

export const userApiKeyRelations = relations(userApiKey, ({ one }) => ({
  user: one(user, {
    fields: [userApiKey.userId],
    references: [user.id],
  }),
}));

export const linearWebhookDeliveryRelations = relations(linearWebhookDelivery, ({ one }) => ({
  workspaceIntegration: one(workspaceIntegration, {
    fields: [linearWebhookDelivery.workspaceIntegrationId],
    references: [workspaceIntegration.id],
  }),
}));

export const platformAdminAuditLogRelations = relations(platformAdminAuditLog, ({ one }) => ({
  user_userId: one(user, {
    fields: [platformAdminAuditLog.userId],
    references: [user.id],
    relationName: 'platformAdminAuditLog_userId_user_id',
  }),
  user_performedBy: one(user, {
    fields: [platformAdminAuditLog.performedBy],
    references: [user.id],
    relationName: 'platformAdminAuditLog_performedBy_user_id',
  }),
}));

export const workflowConfigRelations = relations(workflowConfig, ({ one }) => ({
  workspace: one(workspace, {
    fields: [workflowConfig.workspaceId],
    references: [workspace.id],
  }),
}));

export const workflowRunRelations = relations(workflowRun, ({ one, many }) => ({
  workspace: one(workspace, {
    fields: [workflowRun.workspaceId],
    references: [workspace.id],
  }),
  repository: one(repository, {
    fields: [workflowRun.repositoryId],
    references: [repository.id],
  }),
  user: one(user, {
    fields: [workflowRun.triggeredByUserId],
    references: [user.id],
  }),
  pullRequestTrigger: one(pullRequestTrigger, {
    fields: [workflowRun.triggerId],
    references: [pullRequestTrigger.id],
  }),
  workflowIssueReferences: many(workflowIssueReference),
}));

export const pullRequestTriggerRelations = relations(pullRequestTrigger, ({ one, many }) => ({
  workflowRuns: many(workflowRun),
  repository: one(repository, {
    fields: [pullRequestTrigger.repositoryId],
    references: [repository.id],
  }),
  workspace: one(workspace, {
    fields: [pullRequestTrigger.workspaceId],
    references: [workspace.id],
  }),
  githubInstallation: one(githubInstallation, {
    fields: [pullRequestTrigger.installationId],
    references: [githubInstallation.installationId],
  }),
}));

export const workflowIssueReferenceRelations = relations(workflowIssueReference, ({ one }) => ({
  workflowRun: one(workflowRun, {
    fields: [workflowIssueReference.workflowRunId],
    references: [workflowRun.id],
  }),
}));

export const claudeSessionRelations = relations(claudeSession, ({ one }) => ({
  pipelineRun: one(pipelineRun, {
    fields: [claudeSession.workflowId],
    references: [pipelineRun.workflowId],
  }),
}));

export const pipelineRunRelations = relations(pipelineRun, ({ one, many }) => ({
  claudeSessions: many(claudeSession),
  draftVersions: many(draftVersion),
  pipeline: one(pipeline, {
    fields: [pipelineRun.pipelineId],
    references: [pipeline.id],
  }),
  phaseExecutions: many(phaseExecution),
  pipelineArtifacts: many(pipelineArtifact),
  analysisArchitectureVersions: many(analysisArchitectureVersion),
  analysisConnectedRepoVersions: many(analysisConnectedRepoVersion),
  analysisDeploymentContextVersions: many(analysisDeploymentContextVersion),
  analysisCapabilityVersions: many(analysisCapabilityVersion),
  analysisDependencyVersions: many(analysisDependencyVersion),
  analysisExternalIntegrationVersions: many(analysisExternalIntegrationVersion),
  analysisFeatureVersions: many(analysisFeatureVersion),
  analysisDiagramVersions: many(analysisDiagramVersion),
  analysisEtiquetteVersions: many(analysisEtiquetteVersion),
  analysisIntraDependencyVersions: many(analysisIntraDependencyVersion),
  analysisLayerVersions: many(analysisLayerVersion),
  analysisProjectSummaryVersions: many(analysisProjectSummaryVersion),
  analysisSetupVersions: many(analysisSetupVersion),
  analysisUxVersions: many(analysisUxVersion),
}));

export const draftVersionRelations = relations(draftVersion, ({ one }) => ({
  pipelineRun: one(pipelineRun, {
    fields: [draftVersion.workflowId],
    references: [pipelineRun.workflowId],
  }),
}));

export const pipelineRelations = relations(pipeline, ({ one, many }) => ({
  pipelineRuns: many(pipelineRun),
  pipelineOutputSchema: one(pipelineOutputSchema, {
    fields: [pipeline.pipelineOutputSchemaId],
    references: [pipelineOutputSchema.id],
  }),
  analysisContexts: many(analysisContext),
}));

export const phaseExecutionRelations = relations(phaseExecution, ({ one }) => ({
  pipelineRun: one(pipelineRun, {
    fields: [phaseExecution.workflowId],
    references: [pipelineRun.workflowId],
  }),
}));

export const pipelineOutputSchemaRelations = relations(pipelineOutputSchema, ({ many }) => ({
  pipelines: many(pipeline),
}));

export const pipelineArtifactRelations = relations(pipelineArtifact, ({ one }) => ({
  pipelineRun: one(pipelineRun, {
    fields: [pipelineArtifact.workflowId],
    references: [pipelineRun.workflowId],
  }),
}));

export const analysisContextRelations = relations(analysisContext, ({ one, many }) => ({
  project: one(project, {
    fields: [analysisContext.projectId],
    references: [project.id],
  }),
  pipeline: one(pipeline, {
    fields: [analysisContext.pipelineId],
    references: [pipeline.id],
  }),
  analysisRunRepositories: many(analysisRunRepository),
}));

export const pullRequestStateRelations = relations(pullRequestState, ({ one, many }) => ({
  repository: one(repository, {
    fields: [pullRequestState.repositoryId],
    references: [repository.id],
  }),
  pullRequestActionItems: many(pullRequestActionItem),
}));

export const analysisCapabilityRelations = relations(analysisCapability, ({ one, many }) => ({
  workspace: one(workspace, {
    fields: [analysisCapability.workspaceId],
    references: [workspace.id],
  }),
  project: one(project, {
    fields: [analysisCapability.projectId],
    references: [project.id],
  }),
  analysisCapabilityVersions: many(analysisCapabilityVersion),
  goalCapabilities: many(goalCapability),
}));

export const analysisArchitectureRelations = relations(analysisArchitecture, ({ one, many }) => ({
  workspace: one(workspace, {
    fields: [analysisArchitecture.workspaceId],
    references: [workspace.id],
  }),
  project: one(project, {
    fields: [analysisArchitecture.projectId],
    references: [project.id],
  }),
  analysisArchitectureVersions: many(analysisArchitectureVersion),
}));

export const analysisArchitectureVersionRelations = relations(
  analysisArchitectureVersion,
  ({ one }) => ({
    analysisArchitecture: one(analysisArchitecture, {
      fields: [analysisArchitectureVersion.architectureId],
      references: [analysisArchitecture.id],
    }),
    pipelineRun: one(pipelineRun, {
      fields: [analysisArchitectureVersion.pipelineRunId],
      references: [pipelineRun.workflowId],
    }),
  }),
);

export const analysisConnectedRepoRelations = relations(analysisConnectedRepo, ({ one, many }) => ({
  workspace: one(workspace, {
    fields: [analysisConnectedRepo.workspaceId],
    references: [workspace.id],
  }),
  project: one(project, {
    fields: [analysisConnectedRepo.projectId],
    references: [project.id],
  }),
  analysisConnectedRepoVersions: many(analysisConnectedRepoVersion),
}));

export const analysisConnectedRepoVersionRelations = relations(
  analysisConnectedRepoVersion,
  ({ one }) => ({
    analysisConnectedRepo: one(analysisConnectedRepo, {
      fields: [analysisConnectedRepoVersion.connectedRepoId],
      references: [analysisConnectedRepo.id],
    }),
    pipelineRun: one(pipelineRun, {
      fields: [analysisConnectedRepoVersion.pipelineRunId],
      references: [pipelineRun.workflowId],
    }),
  }),
);

export const analysisContextArtifactRelations = relations(
  analysisContextArtifact,
  ({ one, many }) => ({
    workspace: one(workspace, {
      fields: [analysisContextArtifact.workspaceId],
      references: [workspace.id],
    }),
    project: one(project, {
      fields: [analysisContextArtifact.projectId],
      references: [project.id],
    }),
    prds: many(prd),
    technicalSpecs: many(technicalSpec),
  }),
);

export const analysisDependencyRelations = relations(analysisDependency, ({ one, many }) => ({
  workspace: one(workspace, {
    fields: [analysisDependency.workspaceId],
    references: [workspace.id],
  }),
  project: one(project, {
    fields: [analysisDependency.projectId],
    references: [project.id],
  }),
  analysisDependencyVersions: many(analysisDependencyVersion),
}));

export const analysisDeploymentContextRelations = relations(
  analysisDeploymentContext,
  ({ one, many }) => ({
    workspace: one(workspace, {
      fields: [analysisDeploymentContext.workspaceId],
      references: [workspace.id],
    }),
    project: one(project, {
      fields: [analysisDeploymentContext.projectId],
      references: [project.id],
    }),
    analysisDeploymentContextVersions: many(analysisDeploymentContextVersion),
  }),
);

export const analysisDeploymentContextVersionRelations = relations(
  analysisDeploymentContextVersion,
  ({ one }) => ({
    analysisDeploymentContext: one(analysisDeploymentContext, {
      fields: [analysisDeploymentContextVersion.deploymentContextId],
      references: [analysisDeploymentContext.id],
    }),
    pipelineRun: one(pipelineRun, {
      fields: [analysisDeploymentContextVersion.pipelineRunId],
      references: [pipelineRun.workflowId],
    }),
  }),
);

export const analysisDiagramRelations = relations(analysisDiagram, ({ one, many }) => ({
  workspace: one(workspace, {
    fields: [analysisDiagram.workspaceId],
    references: [workspace.id],
  }),
  project: one(project, {
    fields: [analysisDiagram.projectId],
    references: [project.id],
  }),
  analysisDiagramVersions: many(analysisDiagramVersion),
}));

export const analysisCapabilityVersionRelations = relations(
  analysisCapabilityVersion,
  ({ one }) => ({
    analysisCapability: one(analysisCapability, {
      fields: [analysisCapabilityVersion.capabilityId],
      references: [analysisCapability.id],
    }),
    pipelineRun: one(pipelineRun, {
      fields: [analysisCapabilityVersion.pipelineRunId],
      references: [pipelineRun.workflowId],
    }),
  }),
);

export const analysisDependencyVersionRelations = relations(
  analysisDependencyVersion,
  ({ one }) => ({
    analysisDependency: one(analysisDependency, {
      fields: [analysisDependencyVersion.dependencyId],
      references: [analysisDependency.id],
    }),
    pipelineRun: one(pipelineRun, {
      fields: [analysisDependencyVersion.pipelineRunId],
      references: [pipelineRun.workflowId],
    }),
  }),
);

export const analysisExternalIntegrationRelations = relations(
  analysisExternalIntegration,
  ({ one, many }) => ({
    workspace: one(workspace, {
      fields: [analysisExternalIntegration.workspaceId],
      references: [workspace.id],
    }),
    project: one(project, {
      fields: [analysisExternalIntegration.projectId],
      references: [project.id],
    }),
    analysisExternalIntegrationVersions: many(analysisExternalIntegrationVersion),
  }),
);

export const analysisExternalIntegrationVersionRelations = relations(
  analysisExternalIntegrationVersion,
  ({ one }) => ({
    analysisExternalIntegration: one(analysisExternalIntegration, {
      fields: [analysisExternalIntegrationVersion.externalIntegrationId],
      references: [analysisExternalIntegration.id],
    }),
    pipelineRun: one(pipelineRun, {
      fields: [analysisExternalIntegrationVersion.pipelineRunId],
      references: [pipelineRun.workflowId],
    }),
  }),
);

export const analysisFeatureRelations = relations(analysisFeature, ({ one, many }) => ({
  workspace: one(workspace, {
    fields: [analysisFeature.workspaceId],
    references: [workspace.id],
  }),
  project: one(project, {
    fields: [analysisFeature.projectId],
    references: [project.id],
  }),
  analysisFeatureVersions: many(analysisFeatureVersion),
  goalFeatures: many(goalFeature),
}));

export const analysisFeatureVersionRelations = relations(analysisFeatureVersion, ({ one }) => ({
  analysisFeature: one(analysisFeature, {
    fields: [analysisFeatureVersion.featureId],
    references: [analysisFeature.id],
  }),
  pipelineRun: one(pipelineRun, {
    fields: [analysisFeatureVersion.pipelineRunId],
    references: [pipelineRun.workflowId],
  }),
}));

export const analysisIntraDependencyRelations = relations(
  analysisIntraDependency,
  ({ one, many }) => ({
    workspace: one(workspace, {
      fields: [analysisIntraDependency.workspaceId],
      references: [workspace.id],
    }),
    project: one(project, {
      fields: [analysisIntraDependency.projectId],
      references: [project.id],
    }),
    analysisIntraDependencyVersions: many(analysisIntraDependencyVersion),
  }),
);

export const analysisLayerRelations = relations(analysisLayer, ({ one, many }) => ({
  workspace: one(workspace, {
    fields: [analysisLayer.workspaceId],
    references: [workspace.id],
  }),
  project: one(project, {
    fields: [analysisLayer.projectId],
    references: [project.id],
  }),
  analysisLayerVersions: many(analysisLayerVersion),
  goalLayers: many(goalLayer),
}));

export const analysisDiagramVersionRelations = relations(analysisDiagramVersion, ({ one }) => ({
  analysisDiagram: one(analysisDiagram, {
    fields: [analysisDiagramVersion.diagramId],
    references: [analysisDiagram.id],
  }),
  pipelineRun: one(pipelineRun, {
    fields: [analysisDiagramVersion.pipelineRunId],
    references: [pipelineRun.workflowId],
  }),
}));

export const analysisEtiquetteRelations = relations(analysisEtiquette, ({ one, many }) => ({
  workspace: one(workspace, {
    fields: [analysisEtiquette.workspaceId],
    references: [workspace.id],
  }),
  project: one(project, {
    fields: [analysisEtiquette.projectId],
    references: [project.id],
  }),
  analysisEtiquetteVersions: many(analysisEtiquetteVersion),
}));

export const analysisEtiquetteVersionRelations = relations(analysisEtiquetteVersion, ({ one }) => ({
  analysisEtiquette: one(analysisEtiquette, {
    fields: [analysisEtiquetteVersion.etiquetteId],
    references: [analysisEtiquette.id],
  }),
  pipelineRun: one(pipelineRun, {
    fields: [analysisEtiquetteVersion.pipelineRunId],
    references: [pipelineRun.workflowId],
  }),
}));

export const analysisIntraDependencyVersionRelations = relations(
  analysisIntraDependencyVersion,
  ({ one }) => ({
    analysisIntraDependency: one(analysisIntraDependency, {
      fields: [analysisIntraDependencyVersion.intraDependencyId],
      references: [analysisIntraDependency.id],
    }),
    pipelineRun: one(pipelineRun, {
      fields: [analysisIntraDependencyVersion.pipelineRunId],
      references: [pipelineRun.workflowId],
    }),
  }),
);

export const analysisLayerVersionRelations = relations(analysisLayerVersion, ({ one }) => ({
  analysisLayer: one(analysisLayer, {
    fields: [analysisLayerVersion.layerId],
    references: [analysisLayer.id],
  }),
  pipelineRun: one(pipelineRun, {
    fields: [analysisLayerVersion.pipelineRunId],
    references: [pipelineRun.workflowId],
  }),
}));

export const analysisProjectSummaryRelations = relations(
  analysisProjectSummary,
  ({ one, many }) => ({
    workspace: one(workspace, {
      fields: [analysisProjectSummary.workspaceId],
      references: [workspace.id],
    }),
    project: one(project, {
      fields: [analysisProjectSummary.projectId],
      references: [project.id],
    }),
    analysisProjectSummaryVersions: many(analysisProjectSummaryVersion),
  }),
);

export const analysisProjectSummaryVersionRelations = relations(
  analysisProjectSummaryVersion,
  ({ one }) => ({
    analysisProjectSummary: one(analysisProjectSummary, {
      fields: [analysisProjectSummaryVersion.projectSummaryId],
      references: [analysisProjectSummary.id],
    }),
    pipelineRun: one(pipelineRun, {
      fields: [analysisProjectSummaryVersion.pipelineRunId],
      references: [pipelineRun.workflowId],
    }),
  }),
);

export const analysisSetupRelations = relations(analysisSetup, ({ one, many }) => ({
  workspace: one(workspace, {
    fields: [analysisSetup.workspaceId],
    references: [workspace.id],
  }),
  project: one(project, {
    fields: [analysisSetup.projectId],
    references: [project.id],
  }),
  analysisSetupVersions: many(analysisSetupVersion),
}));

export const analysisSetupVersionRelations = relations(analysisSetupVersion, ({ one }) => ({
  analysisSetup: one(analysisSetup, {
    fields: [analysisSetupVersion.setupId],
    references: [analysisSetup.id],
  }),
  pipelineRun: one(pipelineRun, {
    fields: [analysisSetupVersion.pipelineRunId],
    references: [pipelineRun.workflowId],
  }),
}));

export const analysisUxRelations = relations(analysisUx, ({ one, many }) => ({
  workspace: one(workspace, {
    fields: [analysisUx.workspaceId],
    references: [workspace.id],
  }),
  project: one(project, {
    fields: [analysisUx.projectId],
    references: [project.id],
  }),
  analysisUxVersions: many(analysisUxVersion),
}));

export const analysisUxVersionRelations = relations(analysisUxVersion, ({ one }) => ({
  analysisUx: one(analysisUx, {
    fields: [analysisUxVersion.uxId],
    references: [analysisUx.id],
  }),
  pipelineRun: one(pipelineRun, {
    fields: [analysisUxVersion.pipelineRunId],
    references: [pipelineRun.workflowId],
  }),
}));

export const sessionEventRelations = relations(sessionEvent, ({ one }) => ({
  workspace: one(workspace, {
    fields: [sessionEvent.workspaceId],
    references: [workspace.id],
  }),
  project: one(project, {
    fields: [sessionEvent.projectId],
    references: [project.id],
  }),
}));

export const flowRelations = relations(flow, ({ one }) => ({
  workspace: one(workspace, {
    fields: [flow.workspaceId],
    references: [workspace.id],
  }),
  prd: one(prd, {
    fields: [flow.prdId],
    references: [prd.id],
  }),
}));

export const taskRelations = relations(task, ({ one, many }) => ({
  workspace: one(workspace, {
    fields: [task.workspaceId],
    references: [workspace.id],
  }),
  technicalSpec: one(technicalSpec, {
    fields: [task.technicalSpecId],
    references: [technicalSpec.id],
  }),
  user: one(user, {
    fields: [task.createdByUserId],
    references: [user.id],
  }),
  taskDependencies_taskId: many(taskDependency, {
    relationName: 'taskDependency_taskId_task_id',
  }),
  taskDependencies_dependsOnTaskId: many(taskDependency, {
    relationName: 'taskDependency_dependsOnTaskId_task_id',
  }),
}));

export const planRelations = relations(plan, ({ one }) => ({
  goal: one(goal, {
    fields: [plan.goalId],
    references: [goal.id],
  }),
  project: one(project, {
    fields: [plan.projectId],
    references: [project.id],
  }),
}));

export const projectAnalysisRelations = relations(projectAnalysis, ({ one }) => ({
  project: one(project, {
    fields: [projectAnalysis.projectId],
    references: [project.id],
  }),
}));

export const sandboxLifecycleEventRelations = relations(sandboxLifecycleEvent, ({ one }) => ({
  workspace: one(workspace, {
    fields: [sandboxLifecycleEvent.workspaceId],
    references: [workspace.id],
  }),
  project: one(project, {
    fields: [sandboxLifecycleEvent.projectId],
    references: [project.id],
  }),
  goal: one(goal, {
    fields: [sandboxLifecycleEvent.goalId],
    references: [goal.id],
  }),
  user: one(user, {
    fields: [sandboxLifecycleEvent.userId],
    references: [user.id],
  }),
  repository: one(repository, {
    fields: [sandboxLifecycleEvent.repositoryId],
    references: [repository.id],
  }),
}));

export const sandboxLifecycleSnapshotRelations = relations(sandboxLifecycleSnapshot, ({ one }) => ({
  workspace: one(workspace, {
    fields: [sandboxLifecycleSnapshot.workspaceId],
    references: [workspace.id],
  }),
  project: one(project, {
    fields: [sandboxLifecycleSnapshot.projectId],
    references: [project.id],
  }),
  goal: one(goal, {
    fields: [sandboxLifecycleSnapshot.goalId],
    references: [goal.id],
  }),
  user: one(user, {
    fields: [sandboxLifecycleSnapshot.userId],
    references: [user.id],
  }),
  repository: one(repository, {
    fields: [sandboxLifecycleSnapshot.repositoryId],
    references: [repository.id],
  }),
}));

export const sandboxWorkflowMappingRelations = relations(sandboxWorkflowMapping, ({ one }) => ({
  workspace: one(workspace, {
    fields: [sandboxWorkflowMapping.workspaceId],
    references: [workspace.id],
  }),
  project: one(project, {
    fields: [sandboxWorkflowMapping.projectId],
    references: [project.id],
  }),
  repository: one(repository, {
    fields: [sandboxWorkflowMapping.repositoryId],
    references: [repository.id],
  }),
}));

export const pullRequestActionItemSourceRelations = relations(
  pullRequestActionItemSource,
  ({ one }) => ({
    pullRequestActionItem: one(pullRequestActionItem, {
      fields: [pullRequestActionItemSource.actionItemId],
      references: [pullRequestActionItem.id],
    }),
  }),
);

export const pullRequestActionItemRelations = relations(pullRequestActionItem, ({ one, many }) => ({
  pullRequestActionItemSources: many(pullRequestActionItemSource),
  pullRequestState: one(pullRequestState, {
    fields: [pullRequestActionItem.pullRequestStateId],
    references: [pullRequestState.id],
  }),
  pullRequestActionItemDependencies_actionItemId: many(pullRequestActionItemDependency, {
    relationName: 'pullRequestActionItemDependency_actionItemId_pullRequestActionItem_id',
  }),
  pullRequestActionItemDependencies_dependsOnActionItemId: many(pullRequestActionItemDependency, {
    relationName: 'pullRequestActionItemDependency_dependsOnActionItemId_pullRequestActionItem_id',
  }),
}));

export const repositorySandboxSessionRelations = relations(
  repositorySandboxSession,
  ({ one, many }) => ({
    workspace: one(workspace, {
      fields: [repositorySandboxSession.workspaceId],
      references: [workspace.id],
    }),
    project: one(project, {
      fields: [repositorySandboxSession.projectId],
      references: [project.id],
    }),
    repository: one(repository, {
      fields: [repositorySandboxSession.repositoryId],
      references: [repository.id],
    }),
    user: one(user, {
      fields: [repositorySandboxSession.userId],
      references: [user.id],
    }),
    repositorySandboxTerminalEvents: many(repositorySandboxTerminalEvent),
  }),
);

export const repositorySandboxTerminalEventRelations = relations(
  repositorySandboxTerminalEvent,
  ({ one }) => ({
    repositorySandboxSession: one(repositorySandboxSession, {
      fields: [repositorySandboxTerminalEvent.sessionId],
      references: [repositorySandboxSession.id],
    }),
  }),
);

export const workspaceInviteLinkRelations = relations(workspaceInviteLink, ({ one, many }) => ({
  workspace: one(workspace, {
    fields: [workspaceInviteLink.workspaceId],
    references: [workspace.id],
  }),
  user: one(user, {
    fields: [workspaceInviteLink.createdByUserId],
    references: [user.id],
  }),
  workspaceInviteLinkUses: many(workspaceInviteLinkUse),
}));

export const workspaceInviteLinkUseRelations = relations(workspaceInviteLinkUse, ({ one }) => ({
  workspaceInviteLink: one(workspaceInviteLink, {
    fields: [workspaceInviteLinkUse.inviteLinkId],
    references: [workspaceInviteLink.id],
  }),
  user: one(user, {
    fields: [workspaceInviteLinkUse.userId],
    references: [user.id],
  }),
}));

export const templateRelations = relations(template, ({ one }) => ({
  workspace: one(workspace, {
    fields: [template.workspaceId],
    references: [workspace.id],
  }),
}));

export const goalLayerRelations = relations(goalLayer, ({ one }) => ({
  goal: one(goal, {
    fields: [goalLayer.goalId],
    references: [goal.id],
  }),
  analysisLayer: one(analysisLayer, {
    fields: [goalLayer.layerId],
    references: [analysisLayer.id],
  }),
}));

export const goalCapabilityRelations = relations(goalCapability, ({ one }) => ({
  goal: one(goal, {
    fields: [goalCapability.goalId],
    references: [goal.id],
  }),
  analysisCapability: one(analysisCapability, {
    fields: [goalCapability.capabilityId],
    references: [analysisCapability.id],
  }),
}));

export const goalConnectionRelations = relations(goalConnection, ({ one }) => ({
  goal_goalId: one(goal, {
    fields: [goalConnection.goalId],
    references: [goal.id],
    relationName: 'goalConnection_goalId_goal_id',
  }),
  goal_connectedGoalId: one(goal, {
    fields: [goalConnection.connectedGoalId],
    references: [goal.id],
    relationName: 'goalConnection_connectedGoalId_goal_id',
  }),
}));

export const goalFeatureRelations = relations(goalFeature, ({ one }) => ({
  goal: one(goal, {
    fields: [goalFeature.goalId],
    references: [goal.id],
  }),
  analysisFeature: one(analysisFeature, {
    fields: [goalFeature.featureId],
    references: [analysisFeature.id],
  }),
}));

export const taskDependencyRelations = relations(taskDependency, ({ one }) => ({
  task_taskId: one(task, {
    fields: [taskDependency.taskId],
    references: [task.id],
    relationName: 'taskDependency_taskId_task_id',
  }),
  task_dependsOnTaskId: one(task, {
    fields: [taskDependency.dependsOnTaskId],
    references: [task.id],
    relationName: 'taskDependency_dependsOnTaskId_task_id',
  }),
}));

export const pullRequestActionItemDependencyRelations = relations(
  pullRequestActionItemDependency,
  ({ one }) => ({
    pullRequestActionItem_actionItemId: one(pullRequestActionItem, {
      fields: [pullRequestActionItemDependency.actionItemId],
      references: [pullRequestActionItem.id],
      relationName: 'pullRequestActionItemDependency_actionItemId_pullRequestActionItem_id',
    }),
    pullRequestActionItem_dependsOnActionItemId: one(pullRequestActionItem, {
      fields: [pullRequestActionItemDependency.dependsOnActionItemId],
      references: [pullRequestActionItem.id],
      relationName:
        'pullRequestActionItemDependency_dependsOnActionItemId_pullRequestActionItem_id',
    }),
  }),
);

export const projectRepositoryRelations = relations(projectRepository, ({ one }) => ({
  project: one(project, {
    fields: [projectRepository.projectId],
    references: [project.id],
  }),
  repository: one(repository, {
    fields: [projectRepository.repositoryId],
    references: [repository.id],
  }),
}));

export const linearIssueLabelRelations = relations(linearIssueLabel, ({ one }) => ({
  linearIssue: one(linearIssue, {
    fields: [linearIssueLabel.issueId],
    references: [linearIssue.id],
  }),
  linearLabel: one(linearLabel, {
    fields: [linearIssueLabel.labelId],
    references: [linearLabel.id],
  }),
}));

export const analysisRunRepositoryRelations = relations(analysisRunRepository, ({ one }) => ({
  analysisContext: one(analysisContext, {
    fields: [analysisRunRepository.workflowId],
    references: [analysisContext.workflowId],
  }),
}));
