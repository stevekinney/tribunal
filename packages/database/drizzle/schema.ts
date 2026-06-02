import {
  pgTable,
  uniqueIndex,
  integer,
  text,
  timestamp,
  bigint,
  index,
  foreignKey,
  check,
  unique,
  varchar,
  boolean,
  jsonb,
  uuid,
  numeric,
  primaryKey,
  pgEnum,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const actionItemSourceType = pgEnum('action_item_source_type', [
  'review_comment',
  'issue_comment',
  'review',
  'ci_check_run',
  'ci_annotation',
  'composite',
]);
export const actionItemStatus = pgEnum('action_item_status', ['pending', 'in_progress', 'done']);
export const authProvider = pgEnum('auth_provider', ['github', 'google']);
export const automationStatus = pgEnum('automation_status', [
  'idle',
  'queued',
  'running',
  'succeeded',
  'failed',
]);
export const branchUpdateStrategy = pgEnum('branch_update_strategy', ['merge', 'rebase']);
export const ciStatus = pgEnum('ci_status', ['pending', 'passing', 'failing', 'error', 'unknown']);
export const credentialRole = pgEnum('credential_role', ['app_actor', 'webhook_admin']);
export const credentialType = pgEnum('credential_type', ['oauth', 'service_account']);
export const documentStatus = pgEnum('document_status', [
  'draft',
  'pending_review',
  'approved',
  'archived',
]);
export const draftTriggeredBy = pgEnum('draft_triggered_by', ['initial', 'revision']);
export const errorCategory = pgEnum('error_category', ['retryable', 'correctable', 'terminal']);
export const flowStatus = pgEnum('flow_status', ['active', 'completed']);
export const flowType = pgEnum('flow_type', ['ideation']);
export const githubAccountType = pgEnum('github_account_type', ['Organization', 'User']);
export const githubInstallationStatus = pgEnum('github_installation_status', [
  'active',
  'suspended',
  'needs_permissions',
  'error',
]);
export const goalScope = pgEnum('goal_scope', [
  'single_line',
  'multiple_lines_same_file',
  'multiple_files_same_module',
  'cross_module',
  'cross_code_source',
]);
export const goalStatus = pgEnum('goal_status', ['draft', 'active', 'completed', 'archived']);
export const goalWorkflowPhase = pgEnum('goal_workflow_phase', [
  'created',
  'planning',
  'planned',
  'started',
  'completed',
  'wontdo',
]);
export const integrationAuditEvent = pgEnum('integration_audit_event', [
  'connected',
  'disconnected',
  'reauth',
  'invalidated',
  'revoked',
  'resource_added',
  'resource_removed',
  'resource_synced',
]);
export const integrationProvider = pgEnum('integration_provider', [
  'linear',
  'slack',
  'notion',
  'google_drive',
]);
export const integrationStatus = pgEnum('integration_status', ['active', 'invalid', 'revoked']);
export const issueReferenceType = pgEnum('issue_reference_type', ['linear', 'github']);
export const mergeStatus = pgEnum('merge_status', [
  'clean',
  'conflicts',
  'behind',
  'blocked',
  'unknown',
]);
export const oauthActor = pgEnum('oauth_actor', ['app', 'user']);
export const oauthProvider = pgEnum('oauth_provider', ['github', 'linear']);
export const oauthStatus = pgEnum('oauth_status', ['active', 'invalid', 'expired']);
export const phaseExecutionStatus = pgEnum('phase_execution_status', [
  'not_started',
  'generating',
  'pending_review',
  'revising',
  'completed',
]);
export const phaseTemplateCategory = pgEnum('phase_template_category', [
  'core',
  'analysis',
  'synthesis',
  'mapping',
]);
export const pipelineRunStatus = pgEnum('pipeline_run_status', [
  'started',
  'completed',
  'cancelled',
]);
export const platformAdminAction = pgEnum('platform_admin_action', ['granted', 'revoked']);
export const pullRequestTriggerStatus = pgEnum('pull_request_trigger_status', [
  'pending',
  'processing',
  'completed',
  'superseded',
  'failed',
  'skipped',
]);
export const pullRequestTriggerType = pgEnum('pull_request_trigger_type', [
  'ci_failure',
  'review_comment',
  'review',
  'label',
  'comment',
]);
export const pushConflictPolicy = pgEnum('push_conflict_policy', ['abort']);
export const questionOptionOrder = pgEnum('question_option_order', ['manual', 'random']);
export const questionStatus = pgEnum('question_status', [
  'draft',
  'active',
  'answered',
  'archived',
]);
export const questionType = pgEnum('question_type', [
  'short_answer',
  'multiple_choice',
  'long_form',
  'true_false',
  'slider',
  'stack_ranking',
  'numeric',
]);
export const repositorySandboxSessionStatus = pgEnum('repository_sandbox_session_status', [
  'active',
  'terminated',
  'expired',
  'error',
]);
export const repositorySelection = pgEnum('repository_selection', ['all', 'selected']);
export const resourceType = pgEnum('resource_type', [
  'team',
  'channel',
  'database',
  'folder',
  'project',
  'drive',
]);
export const reviewStatus = pgEnum('review_status', [
  'pending',
  'approved',
  'changes_requested',
  'commented',
  'unknown',
]);
export const sandboxRunStatus = pgEnum('sandbox_run_status', ['active', 'closed', 'killed']);
export const sessionEventSubtype = pgEnum('session_event_subtype', [
  'text',
  'question-response',
  'permission-response',
  'approve-or-reject-create-plan',
  'approve-or-reject-create-goal',
  'plan-response',
  'task-iteration-response',
  'abort',
  'decision-started',
  'decision-made',
  'identification-started',
  'identification-complete',
  'claude-session-started',
  'claude-session-completed',
  'plan-update-started',
  'plan-update-completed',
  'assistant-response',
  'plan-generation-started',
  'plan-generation-updated',
  'plan-generation-completed',
  'plan-iteration-completed',
  'question-generation-started',
  'question-generation-completed',
  'goal-created',
  'task-generation-started',
  'task-generation-completed',
  'task-iteration-completed',
  'flow-created',
  'flow-updated',
  'flow-completed',
]);
export const syncStatus = pgEnum('sync_status', ['idle', 'pending', 'in_progress', 'failed']);
export const taskStatus = pgEnum('task_status', ['pending', 'in_progress', 'completed', 'blocked']);
export const workflowExecutionStatus = pgEnum('workflow_execution_status', [
  'pending',
  'running',
  'completed',
  'failed',
  'cancelled',
]);
export const workflowPhase = pgEnum('workflow_phase', [
  'pending',
  'provisioning',
  'cloning',
  'executing',
  'capturing',
  'cleanup',
  'completed',
  'failed',
  'cancelled',
]);
export const workflowTaskType = pgEnum('workflow_task_type', [
  'analysis',
  'remediation',
  'implementation',
]);
export const workspaceRole = pgEnum('workspace_role', ['administrator', 'viewer']);
export const reviewAgentPolicy = pgEnum('review_agent_policy', ['all_prs', 'labeled_prs']);
export const reviewAgentScope = pgEnum('review_agent_scope', [
  'all_repositories',
  'selected_repositories',
]);
export const reviewAgentRunStatus = pgEnum('review_agent_run_status', [
  'pending',
  'running',
  'completed',
  'failed',
  'skipped',
]);

export const githubWebhookDelivery = pgTable(
  'github_webhook_delivery',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity({
      name: 'github_webhook_delivery_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    deliveryId: text('delivery_id').notNull(),
    eventType: text('event_type').notNull(),
    processedAt: timestamp('processed_at', { mode: 'string' }).defaultNow().notNull(),
    // You can use { mode: "bigint" } if numbers are exceeding js number limitations
    installationId: bigint('installation_id', { mode: 'number' }),
  },
  (table) => [
    uniqueIndex('github_webhook_delivery_unique').using(
      'btree',
      table.deliveryId.asc().nullsLast().op('text_ops'),
      table.eventType.asc().nullsLast().op('text_ops'),
    ),
  ],
);

export const project = pgTable(
  'project',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity({
      name: 'project_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    workspaceId: integer('workspace_id').notNull(),
    name: text().notNull(),
    displayName: text('display_name').notNull(),
    handle: text().notNull(),
    createdAt: timestamp('created_at', { mode: 'string' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow().notNull(),
    description: text(),
  },
  (table) => [
    uniqueIndex('project_workspace_handle_idx').using(
      'btree',
      table.workspaceId.asc().nullsLast().op('int4_ops'),
      table.handle.asc().nullsLast().op('int4_ops'),
    ),
    index('project_workspace_idx').using(
      'btree',
      table.workspaceId.asc().nullsLast().op('int4_ops'),
    ),
    foreignKey({
      columns: [table.workspaceId],
      foreignColumns: [workspace.id],
      name: 'project_workspace_id_workspace_id_fk',
    }).onDelete('cascade'),
    check('project_handle_lowercase', sql`handle = lower(handle)`),
    check(
      'project_handle_not_reserved',
      sql`handle <> ALL (ARRAY['new'::text, 'create'::text, 'edit'::text, 'delete'::text, 'update'::text, 'remove'::text, 'settings'::text, 'goals'::text, 'questions'::text, 'analysis'::text, 'activity'::text, 'analytics'::text, 'files'::text, 'branches'::text, 'commits'::text, 'pulls'::text, 'pull-requests'::text, 'issues'::text, 'releases'::text, 'deployments'::text, 'environments'::text, 'webhooks'::text, 'api'::text, 'export'::text, 'archive'::text, 'danger'::text, 'repositories'::text, 'templates'::text, 'github'::text, 'linear'::text, 'question-answer'::text, 'admin'::text, 'null'::text, 'undefined'::text])`,
    ),
  ],
);

export const oauthConnection = pgTable(
  'oauth_connection',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity({
      name: 'oauth_connection_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    userId: integer('user_id').notNull(),
    provider: oauthProvider().notNull(),
    providerUserId: text('provider_user_id').notNull(),
    accessToken: text('access_token').notNull(),
    refreshToken: text('refresh_token'),
    expiresAt: timestamp('expires_at', { mode: 'string' }),
    scope: text(),
    status: oauthStatus().default('active'),
    lastCheckedAt: timestamp('last_checked_at', { mode: 'string' }),
    createdAt: timestamp('created_at', { mode: 'string' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('oauth_connection_user_provider_idx').using(
      'btree',
      table.userId.asc().nullsLast().op('int4_ops'),
      table.provider.asc().nullsLast().op('int4_ops'),
    ),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [user.id],
      name: 'oauth_connection_user_id_user_id_fk',
    }).onDelete('cascade'),
  ],
);

export const repository = pgTable(
  'repository',
  {
    // You can use { mode: "bigint" } if numbers are exceeding js number limitations
    id: bigint({ mode: 'number' }).primaryKey().notNull(),
    owner: text().notNull(),
    name: text().notNull(),
    // You can use { mode: "bigint" } if numbers are exceeding js number limitations
    installationId: bigint('installation_id', { mode: 'number' }),
    createdAt: timestamp('created_at', { mode: 'string' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow().notNull(),
    defaultBranch: text('default_branch'),
    uri: text(),
    commit: text(),
  },
  (table) => [
    index('repository_installation_idx').using(
      'btree',
      table.installationId.asc().nullsLast().op('int8_ops'),
    ),
    index('repository_owner_name_idx').using(
      'btree',
      table.owner.asc().nullsLast().op('text_ops'),
      table.name.asc().nullsLast().op('text_ops'),
    ),
    index('repository_uri_idx').using('btree', table.uri.asc().nullsLast().op('text_ops')),
  ],
);

export const githubInstallation = pgTable(
  'github_installation',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity({
      name: 'github_installation_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    // You can use { mode: "bigint" } if numbers are exceeding js number limitations
    installationId: bigint('installation_id', { mode: 'number' }).notNull(),
    accountLogin: text('account_login').notNull(),
    accountType: githubAccountType('account_type').notNull(),
    // You can use { mode: "bigint" } if numbers are exceeding js number limitations
    accountId: bigint('account_id', { mode: 'number' }).notNull(),
    accountAvatarUrl: text('account_avatar_url'),
    repositorySelection: repositorySelection('repository_selection').notNull(),
    status: githubInstallationStatus().default('active').notNull(),
    statusReason: text('status_reason'),
    lastSyncedAt: timestamp('last_synced_at', { mode: 'string' }),
    createdAt: timestamp('created_at', { mode: 'string' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow().notNull(),
    syncStatus: syncStatus('sync_status').default('idle').notNull(),
    syncError: text('sync_error'),
  },
  (table) => [
    index('github_installation_status_idx').using(
      'btree',
      table.status.asc().nullsLast().op('enum_ops'),
    ),
    unique('github_installation_installation_id_unique').on(table.installationId),
  ],
);

export const serviceAccount = pgTable(
  'service_account',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity({
      name: 'service_account_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    serviceId: varchar('service_id', { length: 64 }).notNull(),
    displayName: varchar('display_name', { length: 255 }).notNull(),
    description: text(),
    isActive: boolean('is_active').default(true).notNull(),
    createdAt: timestamp('created_at', { mode: 'string' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow().notNull(),
  },
  (table) => [
    unique('service_account_service_id_unique').on(table.serviceId),
    check('service_account_service_id_format', sql`(service_id)::text ~ '^[a-z0-9-]{1,64}$'::text`),
  ],
);

export const serviceAuditLog = pgTable(
  'service_audit_log',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity({
      name: 'service_audit_log_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    serviceAccountId: integer('service_account_id'),
    serviceKeyId: integer('service_key_id'),
    attemptedServiceId: varchar('attempted_service_id', { length: 64 }),
    attemptedKeyPrefix: varchar('attempted_key_prefix', { length: 15 }),
    action: varchar({ length: 64 }).notNull(),
    procedurePath: varchar('procedure_path', { length: 255 }),
    ipAddress: varchar('ip_address', { length: 45 }),
    userAgent: text('user_agent'),
    correlationId: varchar('correlation_id', { length: 64 }),
    metadata: jsonb(),
    createdAt: timestamp('created_at', { mode: 'string' }).defaultNow().notNull(),
  },
  (table) => [
    index('service_audit_log_action_created_at_idx').using(
      'btree',
      table.action.asc().nullsLast().op('timestamp_ops'),
      table.createdAt.asc().nullsLast().op('text_ops'),
    ),
    index('service_audit_log_created_at_idx').using(
      'btree',
      table.createdAt.asc().nullsLast().op('timestamp_ops'),
    ),
    index('service_audit_log_service_account_idx').using(
      'btree',
      table.serviceAccountId.asc().nullsLast().op('int4_ops'),
    ),
    foreignKey({
      columns: [table.serviceKeyId],
      foreignColumns: [serviceKey.id],
      name: 'service_audit_log_service_key_id_service_key_id_fk',
    }),
    foreignKey({
      columns: [table.serviceAccountId],
      foreignColumns: [serviceAccount.id],
      name: 'service_audit_log_service_account_id_service_account_id_fk',
    }),
  ],
);

export const session = pgTable(
  'session',
  {
    id: text().primaryKey().notNull(),
    userId: integer('user_id').notNull(),
    expiresAt: timestamp('expires_at', { mode: 'string' }).notNull(),
    lastAuthAt: timestamp('last_auth_at', { mode: 'string' }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.userId],
      foreignColumns: [user.id],
      name: 'session_user_id_user_id_fk',
    }).onDelete('cascade'),
  ],
);

export const serviceKey = pgTable(
  'service_key',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity({
      name: 'service_key_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    serviceAccountId: integer('service_account_id').notNull(),
    keyHash: varchar('key_hash', { length: 64 }).notNull(),
    keyPrefix: varchar('key_prefix', { length: 15 }).notNull(),
    scopes: jsonb().default([]).notNull(),
    expiresAt: timestamp('expires_at', { mode: 'string' }),
    revokedAt: timestamp('revoked_at', { mode: 'string' }),
    lastUsedAt: timestamp('last_used_at', { mode: 'string' }),
    createdAt: timestamp('created_at', { mode: 'string' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow().notNull(),
  },
  (table) => [
    index('service_key_service_account_idx').using(
      'btree',
      table.serviceAccountId.asc().nullsLast().op('int4_ops'),
    ),
    foreignKey({
      columns: [table.serviceAccountId],
      foreignColumns: [serviceAccount.id],
      name: 'service_key_service_account_id_service_account_id_fk',
    }).onDelete('cascade'),
    unique('service_key_key_prefix_unique').on(table.keyPrefix),
    check('service_key_prefix_format', sql`(key_prefix)::text ~ '^sk_[0-9a-f]{12}$'::text`),
  ],
);

export const webhookEvent = pgTable(
  'webhook_event',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity({
      name: 'webhook_event_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    eventType: text('event_type').notNull(),
    action: text(),
    deliveryId: text('delivery_id'),
    payload: text().notNull(),
    // You can use { mode: "bigint" } if numbers are exceeding js number limitations
    repositoryId: bigint('repository_id', { mode: 'number' }).notNull(),
    // You can use { mode: "bigint" } if numbers are exceeding js number limitations
    installationId: bigint('installation_id', { mode: 'number' }),
    // You can use { mode: "bigint" } if numbers are exceeding js number limitations
    senderId: bigint('sender_id', { mode: 'number' }),
    senderLogin: text('sender_login'),
    prNumber: integer('pr_number'),
    issueNumber: integer('issue_number'),
    ref: text(),
    commitSha: text('commit_sha'),
    githubCreatedAt: timestamp('github_created_at', { mode: 'string' }),
    receivedAt: timestamp('received_at', { mode: 'string' }).defaultNow().notNull(),
    createdAt: timestamp('created_at', { mode: 'string' }).defaultNow().notNull(),
  },
  (table) => [
    index('webhook_event_repository_created_idx').using(
      'btree',
      table.repositoryId.asc().nullsLast().op('int8_ops'),
      table.createdAt.asc().nullsLast().op('int8_ops'),
    ),
    index('webhook_event_repository_received_idx').using(
      'btree',
      table.repositoryId.asc().nullsLast().op('timestamp_ops'),
      table.receivedAt.asc().nullsLast().op('timestamp_ops'),
    ),
    index('webhook_event_repository_type_idx').using(
      'btree',
      table.repositoryId.asc().nullsLast().op('int8_ops'),
      table.eventType.asc().nullsLast().op('text_ops'),
    ),
    foreignKey({
      columns: [table.repositoryId],
      foreignColumns: [repository.id],
      name: 'webhook_event_repository_id_repository_id_fk',
    }).onDelete('cascade'),
    unique('webhook_event_delivery_id_unique').on(table.deliveryId),
  ],
);

export const githubInstallationRepository = pgTable(
  'github_installation_repository',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity({
      name: 'github_installation_repository_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    // You can use { mode: "bigint" } if numbers are exceeding js number limitations
    installationId: bigint('installation_id', { mode: 'number' }).notNull(),
    // You can use { mode: "bigint" } if numbers are exceeding js number limitations
    repositoryId: bigint('repository_id', { mode: 'number' }).notNull(),
    isActive: boolean('is_active').default(true).notNull(),
    addedAt: timestamp('added_at', { mode: 'string' }).defaultNow().notNull(),
    removedAt: timestamp('removed_at', { mode: 'string' }),
  },
  (table) => [
    index('github_installation_repository_installation_idx').using(
      'btree',
      table.installationId.asc().nullsLast().op('int8_ops'),
    ),
    index('github_installation_repository_repository_idx').using(
      'btree',
      table.repositoryId.asc().nullsLast().op('int8_ops'),
    ),
    uniqueIndex('github_installation_repository_unique').using(
      'btree',
      table.installationId.asc().nullsLast().op('int8_ops'),
      table.repositoryId.asc().nullsLast().op('int8_ops'),
    ),
    foreignKey({
      columns: [table.repositoryId],
      foreignColumns: [repository.id],
      name: 'github_installation_repository_repository_id_repository_id_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.installationId],
      foreignColumns: [githubInstallation.installationId],
      name: 'github_installation_repository_installation_id_github_installat',
    }).onDelete('cascade'),
  ],
);

export const workspace = pgTable(
  'workspace',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity({
      name: 'workspace_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    name: text().notNull(),
    handle: text().notNull(),
    createdAt: timestamp('created_at', { mode: 'string' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow().notNull(),
  },
  (table) => [
    unique('workspace_handle_unique').on(table.handle),
    check('workspace_handle_lowercase', sql`handle = lower(handle)`),
    check(
      'workspace_handle_format',
      sql`(handle ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$'::text) OR (handle ~ '^[a-z0-9]$'::text)`,
    ),
    check(
      'workspace_handle_not_reserved',
      sql`handle <> ALL (ARRAY['new'::text, 'create'::text, 'settings'::text, 'edit'::text, 'delete'::text])`,
    ),
  ],
);

export const workspaceGithubInstallation = pgTable(
  'workspace_github_installation',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity({
      name: 'workspace_github_installation_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    workspaceId: integer('workspace_id').notNull(),
    // You can use { mode: "bigint" } if numbers are exceeding js number limitations
    installationId: bigint('installation_id', { mode: 'number' }).notNull(),
    connectedByUserId: integer('connected_by_user_id'),
    connectedAt: timestamp('connected_at', { mode: 'string' }).defaultNow().notNull(),
  },
  (table) => [
    index('workspace_github_installation_installation_idx').using(
      'btree',
      table.installationId.asc().nullsLast().op('int8_ops'),
    ),
    index('workspace_github_installation_workspace_idx').using(
      'btree',
      table.workspaceId.asc().nullsLast().op('int4_ops'),
    ),
    uniqueIndex('workspace_github_installation_workspace_installation_unique').using(
      'btree',
      table.workspaceId.asc().nullsLast().op('int8_ops'),
      table.installationId.asc().nullsLast().op('int8_ops'),
    ),
    foreignKey({
      columns: [table.workspaceId],
      foreignColumns: [workspace.id],
      name: 'workspace_github_installation_workspace_id_workspace_id_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.connectedByUserId],
      foreignColumns: [user.id],
      name: 'workspace_github_installation_connected_by_user_id_user_id_fk',
    }).onDelete('set null'),
    foreignKey({
      columns: [table.installationId],
      foreignColumns: [githubInstallation.installationId],
      name: 'workspace_github_installation_installation_id_github_installati',
    }).onDelete('cascade'),
  ],
);

export const workspaceMembership = pgTable(
  'workspace_membership',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity({
      name: 'workspace_membership_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    workspaceId: integer('workspace_id').notNull(),
    userId: integer('user_id').notNull(),
    role: workspaceRole().notNull(),
    createdAt: timestamp('created_at', { mode: 'string' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('workspace_membership_unique').using(
      'btree',
      table.workspaceId.asc().nullsLast().op('int4_ops'),
      table.userId.asc().nullsLast().op('int4_ops'),
    ),
    index('workspace_membership_user_idx').using(
      'btree',
      table.userId.asc().nullsLast().op('int4_ops'),
    ),
    index('workspace_membership_workspace_idx').using(
      'btree',
      table.workspaceId.asc().nullsLast().op('int4_ops'),
    ),
    foreignKey({
      columns: [table.workspaceId],
      foreignColumns: [workspace.id],
      name: 'workspace_membership_workspace_id_workspace_id_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [user.id],
      name: 'workspace_membership_user_id_user_id_fk',
    }).onDelete('cascade'),
  ],
);

export const goal = pgTable(
  'goal',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity({
      name: 'goal_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    workspaceId: integer('workspace_id').notNull(),
    projectId: integer('project_id'),
    // You can use { mode: "bigint" } if numbers are exceeding js number limitations
    repositoryId: bigint('repository_id', { mode: 'number' }),
    parentGoalId: integer('parent_goal_id'),
    title: text().notNull(),
    description: text(),
    status: goalStatus().default('draft').notNull(),
    intents: jsonb().default([]),
    domains: jsonb().default([]),
    currentVersionNumber: integer('current_version_number').default(1).notNull(),
    originatingPrompt: text('originating_prompt'),
    originatingSessionId: text('originating_session_id'),
    createdByUserId: integer('created_by_user_id'),
    createdAt: timestamp('created_at', { mode: 'string' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow().notNull(),
    uuid: text().default(gen_random_uuid()).notNull(),
    goalWorkflowPhase: goalWorkflowPhase('goal_workflow_phase').default('created'),
    scope: goalScope(),
  },
  (table) => [
    index('goal_created_by_idx').using(
      'btree',
      table.createdByUserId.asc().nullsLast().op('int4_ops'),
    ),
    index('goal_parent_idx').using('btree', table.parentGoalId.asc().nullsLast().op('int4_ops')),
    index('goal_project_idx').using('btree', table.projectId.asc().nullsLast().op('int4_ops')),
    index('goal_repository_idx').using(
      'btree',
      table.repositoryId.asc().nullsLast().op('int8_ops'),
    ),
    index('goal_status_idx').using('btree', table.status.asc().nullsLast().op('enum_ops')),
    index('goal_workspace_idx').using('btree', table.workspaceId.asc().nullsLast().op('int4_ops')),
    foreignKey({
      columns: [table.workspaceId],
      foreignColumns: [workspace.id],
      name: 'goal_workspace_id_workspace_id_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.projectId],
      foreignColumns: [project.id],
      name: 'goal_project_id_project_id_fk',
    }).onDelete('set null'),
    foreignKey({
      columns: [table.repositoryId],
      foreignColumns: [repository.id],
      name: 'goal_repository_id_repository_id_fk',
    }).onDelete('set null'),
    foreignKey({
      columns: [table.parentGoalId],
      foreignColumns: [table.id],
      name: 'goal_parent_goal_id_goal_id_fk',
    }).onDelete('set null'),
    foreignKey({
      columns: [table.createdByUserId],
      foreignColumns: [user.id],
      name: 'goal_created_by_user_id_user_id_fk',
    }).onDelete('set null'),
    unique('goal_uuid_unique').on(table.uuid),
  ],
);

export const answerVersion = pgTable(
  'answer_version',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity({
      name: 'answer_version_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    answerId: integer('answer_id').notNull(),
    questionId: integer('question_id').notNull(),
    versionNumber: integer('version_number').notNull(),
    freeFormAnswer: text('free_form_answer'),
    selectedOptionId: text('selected_option_id'),
    customAnswer: text('custom_answer'),
    changeReason: text('change_reason'),
    createdByUserId: integer('created_by_user_id'),
    createdAt: timestamp('created_at', { mode: 'string' }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('answer_version_answer_number_idx').using(
      'btree',
      table.answerId.asc().nullsLast().op('int4_ops'),
      table.versionNumber.asc().nullsLast().op('int4_ops'),
    ),
    index('answer_version_created_at_idx').using(
      'btree',
      table.createdAt.asc().nullsLast().op('timestamp_ops'),
    ),
    index('answer_version_question_idx').using(
      'btree',
      table.questionId.asc().nullsLast().op('int4_ops'),
    ),
    foreignKey({
      columns: [table.answerId],
      foreignColumns: [answer.id],
      name: 'answer_version_answer_id_answer_id_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.questionId],
      foreignColumns: [question.id],
      name: 'answer_version_question_id_question_id_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.createdByUserId],
      foreignColumns: [user.id],
      name: 'answer_version_created_by_user_id_user_id_fk',
    }).onDelete('set null'),
  ],
);

export const answer = pgTable(
  'answer',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity({
      name: 'answer_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    questionId: integer('question_id').notNull(),
    currentVersionId: integer('current_version_id'),
    createdByUserId: integer('created_by_user_id'),
    createdAt: timestamp('created_at', { mode: 'string' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow().notNull(),
    freeFormAnswer: text('free_form_answer'),
    selectedOptionId: text('selected_option_id'),
    customAnswer: text('custom_answer'),
  },
  (table) => [
    index('answer_current_version_idx').using(
      'btree',
      table.currentVersionId.asc().nullsLast().op('int4_ops'),
    ),
    index('answer_question_idx').using('btree', table.questionId.asc().nullsLast().op('int4_ops')),
    uniqueIndex('answer_question_unique_idx').using(
      'btree',
      table.questionId.asc().nullsLast().op('int4_ops'),
    ),
    foreignKey({
      columns: [table.questionId],
      foreignColumns: [question.id],
      name: 'answer_question_id_question_id_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.createdByUserId],
      foreignColumns: [user.id],
      name: 'answer_created_by_user_id_user_id_fk',
    }).onDelete('set null'),
  ],
);

export const user = pgTable(
  'user',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity({
      name: 'user_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    username: text().notNull(),
    name: text(),
    avatarUrl: text('avatar_url'),
    email: text(),
    isPlatformAdmin: boolean('is_platform_admin').default(false).notNull(),
  },
  (table) => [
    uniqueIndex('user_email_lower_idx')
      .using('btree', sql`lower(email)`)
      .where(sql`(email IS NOT NULL)`),
    index('user_is_platform_admin_idx')
      .using('btree', table.id.asc().nullsLast().op('int4_ops'))
      .where(sql`(is_platform_admin = true)`),
    uniqueIndex('user_username_lower_idx').using('btree', sql`lower(username)`),
    check(
      'user_username_format',
      sql`(username ~ '^[a-z0-9][a-z0-9-]{1,37}[a-z0-9]$'::text) OR (username ~ '^[a-z0-9]{3}$'::text)`,
    ),
    check(
      'user_username_not_reserved',
      sql`lower(username) <> ALL (ARRAY['admin'::text, 'administrator'::text, 'root'::text, 'system'::text, 'support'::text, 'help'::text, 'api'::text, 'www'::text, 'app'::text, 'auth'::text, 'oauth'::text, 'callback'::text, 'login'::text, 'logout'::text, 'signup'::text, 'signin'::text, 'register'::text, 'settings'::text, 'dashboard'::text, 'profile'::text, 'account'::text, 'user'::text, 'users'::text, 'mail'::text, 'email'::text, 'billing'::text, 'payments'::text, 'docs'::text, 'blog'::text, 'status'::text, 'cdn'::text, 'static'::text, 'assets'::text, 'tribunal'::text, 'about'::text, 'team'::text, 'legal'::text, 'privacy'::text, 'terms'::text, 'contact'::text, 'new'::text, 'create'::text, 'edit'::text, 'delete'::text, 'workspace'::text, 'workspaces'::text, 'project'::text, 'projects'::text, 'invitation'::text, 'invitations'::text, 'connection'::text, 'connections'::text, 'connect'::text, 'member'::text, 'members'::text, 'security'::text, 'onboarding'::text, 'reauth'::text, 'link'::text, 'unlink'::text])`,
    ),
  ],
);

export const authAccount = pgTable(
  'auth_account',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity({
      name: 'auth_account_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    userId: integer('user_id').notNull(),
    provider: authProvider().notNull(),
    providerUserId: text('provider_user_id').notNull(),
    providerUsername: text('provider_username'),
    email: text(),
    createdAt: timestamp('created_at', { mode: 'string' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('auth_account_provider_user_idx').using(
      'btree',
      table.provider.asc().nullsLast().op('text_ops'),
      table.providerUserId.asc().nullsLast().op('text_ops'),
    ),
    index('auth_account_user_idx').using('btree', table.userId.asc().nullsLast().op('int4_ops')),
    uniqueIndex('auth_account_user_provider_idx').using(
      'btree',
      table.userId.asc().nullsLast().op('enum_ops'),
      table.provider.asc().nullsLast().op('int4_ops'),
    ),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [user.id],
      name: 'auth_account_user_id_user_id_fk',
    }).onDelete('cascade'),
  ],
);

export const integrationCredential = pgTable(
  'integration_credential',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity({
      name: 'integration_credential_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    workspaceIntegrationId: integer('workspace_integration_id').notNull(),
    credentialType: credentialType('credential_type').default('oauth').notNull(),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    tokenExpiresAt: timestamp('token_expires_at', { mode: 'string' }),
    scopes: text().array(),
    serviceAccountJson: text('service_account_json'),
    createdAt: timestamp('created_at', { mode: 'string' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow().notNull(),
    provider: integrationProvider().notNull(),
    role: credentialRole().default('app_actor').notNull(),
    actor: oauthActor(),
    externalSubjectId: text('external_subject_id'),
    isActive: boolean('is_active').default(true).notNull(),
  },
  (table) => [
    uniqueIndex('integration_credential_active_unique')
      .using(
        'btree',
        table.workspaceIntegrationId.asc().nullsLast().op('int4_ops'),
        table.provider.asc().nullsLast().op('int4_ops'),
        table.role.asc().nullsLast().op('enum_ops'),
      )
      .where(sql`(is_active = true)`),
    index('integration_credential_role_idx').using(
      'btree',
      table.workspaceIntegrationId.asc().nullsLast().op('int4_ops'),
      table.role.asc().nullsLast().op('int4_ops'),
    ),
    foreignKey({
      columns: [table.workspaceIntegrationId],
      foreignColumns: [workspaceIntegration.id],
      name: 'integration_credential_workspace_integration_id_workspace_integ',
    }).onDelete('cascade'),
  ],
);

export const integrationAuditLog = pgTable(
  'integration_audit_log',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity({
      name: 'integration_audit_log_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    workspaceId: integer('workspace_id').notNull(),
    provider: integrationProvider().notNull(),
    event: integrationAuditEvent().notNull(),
    actorUserId: integer('actor_user_id'),
    metadata: jsonb(),
    createdAt: timestamp('created_at', { mode: 'string' }).defaultNow().notNull(),
  },
  (table) => [
    index('integration_audit_log_created_at_idx').using(
      'btree',
      table.createdAt.asc().nullsLast().op('timestamp_ops'),
    ),
    index('integration_audit_log_workspace_idx').using(
      'btree',
      table.workspaceId.asc().nullsLast().op('int4_ops'),
    ),
    index('integration_audit_log_workspace_provider_idx').using(
      'btree',
      table.workspaceId.asc().nullsLast().op('int4_ops'),
      table.provider.asc().nullsLast().op('int4_ops'),
    ),
    foreignKey({
      columns: [table.workspaceId],
      foreignColumns: [workspace.id],
      name: 'integration_audit_log_workspace_id_workspace_id_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.actorUserId],
      foreignColumns: [user.id],
      name: 'integration_audit_log_actor_user_id_user_id_fk',
    }).onDelete('set null'),
  ],
);

export const workspaceIntegration = pgTable(
  'workspace_integration',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity({
      name: 'workspace_integration_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    workspaceId: integer('workspace_id').notNull(),
    provider: integrationProvider().notNull(),
    status: integrationStatus().default('active').notNull(),
    statusReason: text('status_reason'),
    connectedByUserId: integer('connected_by_user_id'),
    providerAccountId: text('provider_account_id'),
    createdAt: timestamp('created_at', { mode: 'string' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow().notNull(),
  },
  (table) => [
    index('workspace_integration_workspace_idx').using(
      'btree',
      table.workspaceId.asc().nullsLast().op('int4_ops'),
    ),
    uniqueIndex('workspace_integration_workspace_provider_unique').using(
      'btree',
      table.workspaceId.asc().nullsLast().op('int4_ops'),
      table.provider.asc().nullsLast().op('int4_ops'),
    ),
    foreignKey({
      columns: [table.workspaceId],
      foreignColumns: [workspace.id],
      name: 'workspace_integration_workspace_id_workspace_id_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.connectedByUserId],
      foreignColumns: [user.id],
      name: 'workspace_integration_connected_by_user_id_user_id_fk',
    }).onDelete('set null'),
  ],
);

export const workspaceIntegrationResource = pgTable(
  'workspace_integration_resource',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity({
      name: 'workspace_integration_resource_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    workspaceIntegrationId: integer('workspace_integration_id').notNull(),
    resourceType: resourceType('resource_type').notNull(),
    externalId: text('external_id').notNull(),
    displayName: text('display_name').notNull(),
    metadata: jsonb(),
    createdAt: timestamp('created_at', { mode: 'string' }).defaultNow().notNull(),
  },
  (table) => [
    index('workspace_integration_resource_integration_idx').using(
      'btree',
      table.workspaceIntegrationId.asc().nullsLast().op('int4_ops'),
    ),
    uniqueIndex('workspace_integration_resource_unique').using(
      'btree',
      table.workspaceIntegrationId.asc().nullsLast().op('text_ops'),
      table.resourceType.asc().nullsLast().op('text_ops'),
      table.externalId.asc().nullsLast().op('int4_ops'),
    ),
    foreignKey({
      columns: [table.workspaceIntegrationId],
      foreignColumns: [workspaceIntegration.id],
      name: 'workspace_integration_resource_workspace_integration_id_workspa',
    }).onDelete('cascade'),
  ],
);

export const goalVersion = pgTable(
  'goal_version',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity({
      name: 'goal_version_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    goalId: integer('goal_id').notNull(),
    versionNumber: integer('version_number').notNull(),
    title: text().notNull(),
    description: text(),
    status: goalStatus().notNull(),
    intents: jsonb(),
    domains: jsonb(),
    projectId: integer('project_id'),
    // You can use { mode: "bigint" } if numbers are exceeding js number limitations
    repositoryId: bigint('repository_id', { mode: 'number' }),
    projectHandle: text('project_handle'),
    repositoryFullName: text('repository_full_name'),
    parentGoalId: integer('parent_goal_id'),
    originatingPrompt: text('originating_prompt'),
    originatingSessionId: text('originating_session_id'),
    changeReason: text('change_reason'),
    createdByUserId: integer('created_by_user_id'),
    createdAt: timestamp('created_at', { mode: 'string' }).defaultNow().notNull(),
    uuid: text(),
    goalWorkflowPhase: goalWorkflowPhase('goal_workflow_phase'),
    scope: goalScope(),
  },
  (table) => [
    index('goal_version_created_at_idx').using(
      'btree',
      table.createdAt.asc().nullsLast().op('timestamp_ops'),
    ),
    index('goal_version_goal_idx').using('btree', table.goalId.asc().nullsLast().op('int4_ops')),
    uniqueIndex('goal_version_goal_number_idx').using(
      'btree',
      table.goalId.asc().nullsLast().op('int4_ops'),
      table.versionNumber.asc().nullsLast().op('int4_ops'),
    ),
    foreignKey({
      columns: [table.goalId],
      foreignColumns: [goal.id],
      name: 'goal_version_goal_id_goal_id_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.createdByUserId],
      foreignColumns: [user.id],
      name: 'goal_version_created_by_user_id_user_id_fk',
    }).onDelete('set null'),
  ],
);

export const linearWebhook = pgTable(
  'linear_webhook',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity({
      name: 'linear_webhook_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    workspaceIntegrationId: integer('workspace_integration_id').notNull(),
    linearWebhookId: text('linear_webhook_id').notNull(),
    secret: text().notNull(),
    teamId: text('team_id'),
    allPublicTeams: boolean('all_public_teams').default(false).notNull(),
    resourceTypes: text('resource_types').array().notNull(),
    label: text(),
    url: text().notNull(),
    enabled: boolean().default(true).notNull(),
    createdAt: timestamp('created_at', { mode: 'string' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('linear_webhook_id_unique').using(
      'btree',
      table.linearWebhookId.asc().nullsLast().op('text_ops'),
    ),
    index('linear_webhook_integration_idx').using(
      'btree',
      table.workspaceIntegrationId.asc().nullsLast().op('int4_ops'),
    ),
    index('linear_webhook_team_idx').using(
      'btree',
      table.workspaceIntegrationId.asc().nullsLast().op('int4_ops'),
      table.teamId.asc().nullsLast().op('int4_ops'),
    ),
    foreignKey({
      columns: [table.workspaceIntegrationId],
      foreignColumns: [workspaceIntegration.id],
      name: 'linear_webhook_workspace_integration_id_workspace_integration_i',
    }).onDelete('cascade'),
  ],
);

export const question = pgTable(
  'question',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity({
      name: 'question_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    workspaceId: integer('workspace_id').notNull(),
    projectId: integer('project_id'),
    // You can use { mode: "bigint" } if numbers are exceeding js number limitations
    repositoryId: bigint('repository_id', { mode: 'number' }),
    goalId: integer('goal_id'),
    status: questionStatus().default('draft').notNull(),
    createdByUserId: integer('created_by_user_id'),
    createdAt: timestamp('created_at', { mode: 'string' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow().notNull(),
    idempotencyKey: varchar('idempotency_key', { length: 255 }),
    prdId: integer('prd_id'),
    technicalSpecId: integer('technical_spec_id'),
    questionText: text('question_text').notNull(),
    description: text(),
    type: questionType().notNull(),
    options: jsonb(),
    allowCustomAnswer: boolean('allow_custom_answer').default(false).notNull(),
    optionOrder: questionOptionOrder('option_order').default('manual').notNull(),
  },
  (table) => [
    index('question_goal_idx').using('btree', table.goalId.asc().nullsLast().op('int4_ops')),
    index('question_prd_idx').using('btree', table.prdId.asc().nullsLast().op('int4_ops')),
    index('question_project_idx').using('btree', table.projectId.asc().nullsLast().op('int4_ops')),
    index('question_repository_idx').using(
      'btree',
      table.repositoryId.asc().nullsLast().op('int8_ops'),
    ),
    index('question_status_idx').using('btree', table.status.asc().nullsLast().op('enum_ops')),
    index('question_technical_spec_idx').using(
      'btree',
      table.technicalSpecId.asc().nullsLast().op('int4_ops'),
    ),
    index('question_type_idx').using('btree', table.type.asc().nullsLast().op('enum_ops')),
    uniqueIndex('question_workspace_idempotency_key_idx')
      .using(
        'btree',
        table.workspaceId.asc().nullsLast().op('int4_ops'),
        table.idempotencyKey.asc().nullsLast().op('int4_ops'),
      )
      .where(sql`(idempotency_key IS NOT NULL)`),
    index('question_workspace_idx').using(
      'btree',
      table.workspaceId.asc().nullsLast().op('int4_ops'),
    ),
    foreignKey({
      columns: [table.prdId],
      foreignColumns: [prd.id],
      name: 'question_prd_id_prd_id_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.technicalSpecId],
      foreignColumns: [technicalSpec.id],
      name: 'question_technical_spec_id_technical_spec_id_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.workspaceId],
      foreignColumns: [workspace.id],
      name: 'question_workspace_id_workspace_id_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.projectId],
      foreignColumns: [project.id],
      name: 'question_project_id_project_id_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.repositoryId],
      foreignColumns: [repository.id],
      name: 'question_repository_id_repository_id_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.goalId],
      foreignColumns: [goal.id],
      name: 'question_goal_id_goal_id_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.createdByUserId],
      foreignColumns: [user.id],
      name: 'question_created_by_user_id_user_id_fk',
    }).onDelete('set null'),
    check(
      'question_scope_exactly_one',
      sql`((
CASE
    WHEN (project_id IS NULL) THEN 0
    ELSE 1
END +
CASE
    WHEN (repository_id IS NULL) THEN 0
    ELSE 1
END) +
CASE
    WHEN (goal_id IS NULL) THEN 0
    ELSE 1
END) = 1`,
    ),
  ],
);

export const agentCheckpoint = pgTable(
  'agent_checkpoint',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    workflowId: text('workflow_id').notNull(),
    runId: text('run_id').notNull(),
    turn: integer().notNull(),
    tokensUsed: integer('tokens_used').default(0).notNull(),
    toolCallsExecuted: integer('tool_calls_executed').default(0).notNull(),
    conversation: jsonb().notNull(),
    truncated: boolean().default(false).notNull(),
    createdAt: timestamp('created_at', { mode: 'string' }).defaultNow().notNull(),
  },
  (table) => [
    index('agent_checkpoint_created_at_idx').using(
      'btree',
      table.createdAt.asc().nullsLast().op('timestamp_ops'),
    ),
    index('agent_checkpoint_workflow_run_idx').using(
      'btree',
      table.workflowId.asc().nullsLast().op('text_ops'),
      table.runId.asc().nullsLast().op('text_ops'),
    ),
  ],
);

export const linearIssue = pgTable(
  'linear_issue',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity({
      name: 'linear_issue_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    projectId: integer('project_id').notNull(),
    teamId: integer('team_id').notNull(),
    linearProjectId: integer('linear_project_id'),
    linearId: text('linear_id').notNull(),
    identifier: text().notNull(),
    title: text().notNull(),
    description: text(),
    priority: integer(),
    priorityLabel: text('priority_label'),
    stateId: text('state_id'),
    stateName: text('state_name'),
    stateType: text('state_type'),
    assigneeId: text('assignee_id'),
    assigneeName: text('assignee_name'),
    creatorId: text('creator_id'),
    dueDate: timestamp('due_date', { mode: 'string' }),
    estimate: numeric({ precision: 5, scale: 2 }),
    url: text().notNull(),
    rawJson: text('raw_json').notNull(),
    linearCreatedAt: timestamp('linear_created_at', { mode: 'string' }),
    linearUpdatedAt: timestamp('linear_updated_at', { mode: 'string' }).notNull(),
    syncedAt: timestamp('synced_at', { mode: 'string' }).defaultNow().notNull(),
    createdAt: timestamp('created_at', { mode: 'string' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow().notNull(),
  },
  (table) => [
    index('linear_issue_assignee_idx').using(
      'btree',
      table.projectId.asc().nullsLast().op('int4_ops'),
      table.assigneeId.asc().nullsLast().op('text_ops'),
    ),
    index('linear_issue_cursor_idx').using(
      'btree',
      table.projectId.asc().nullsLast().op('timestamp_ops'),
      table.linearUpdatedAt.asc().nullsLast().op('timestamp_ops'),
      table.linearId.asc().nullsLast().op('timestamp_ops'),
    ),
    index('linear_issue_linear_project_idx').using(
      'btree',
      table.linearProjectId.asc().nullsLast().op('int4_ops'),
    ),
    uniqueIndex('linear_issue_project_linear_id_unique').using(
      'btree',
      table.projectId.asc().nullsLast().op('text_ops'),
      table.linearId.asc().nullsLast().op('text_ops'),
    ),
    index('linear_issue_state_type_idx').using(
      'btree',
      table.projectId.asc().nullsLast().op('text_ops'),
      table.stateType.asc().nullsLast().op('text_ops'),
    ),
    index('linear_issue_team_idx').using('btree', table.teamId.asc().nullsLast().op('int4_ops')),
    foreignKey({
      columns: [table.projectId],
      foreignColumns: [project.id],
      name: 'linear_issue_project_id_project_id_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.teamId],
      foreignColumns: [linearTeam.id],
      name: 'linear_issue_team_id_linear_team_id_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.linearProjectId],
      foreignColumns: [linearProject.id],
      name: 'linear_issue_linear_project_id_linear_project_id_fk',
    }).onDelete('set null'),
  ],
);

export const linearTeam = pgTable(
  'linear_team',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity({
      name: 'linear_team_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    projectId: integer('project_id').notNull(),
    linearId: text('linear_id').notNull(),
    key: text().notNull(),
    name: text().notNull(),
    description: text(),
    color: text(),
    icon: text(),
    rawJson: text('raw_json').notNull(),
    syncedAt: timestamp('synced_at', { mode: 'string' }).defaultNow().notNull(),
    createdAt: timestamp('created_at', { mode: 'string' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow().notNull(),
  },
  (table) => [
    index('linear_team_project_idx').using(
      'btree',
      table.projectId.asc().nullsLast().op('int4_ops'),
    ),
    uniqueIndex('linear_team_project_linear_id_unique').using(
      'btree',
      table.projectId.asc().nullsLast().op('int4_ops'),
      table.linearId.asc().nullsLast().op('int4_ops'),
    ),
    foreignKey({
      columns: [table.projectId],
      foreignColumns: [project.id],
      name: 'linear_team_project_id_project_id_fk',
    }).onDelete('cascade'),
  ],
);

export const linearProjectRepoMapping = pgTable(
  'linear_project_repo_mapping',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity({
      name: 'linear_project_repo_mapping_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    projectId: integer('project_id').notNull(),
    linearProjectId: integer('linear_project_id').notNull(),
    // You can use { mode: "bigint" } if numbers are exceeding js number limitations
    repositoryId: bigint('repository_id', { mode: 'number' }).notNull(),
    branchOverride: text('branch_override'),
    triggerOnStatuses: text('trigger_on_statuses').array().default(['']).notNull(),
    triggerOnLabels: text('trigger_on_labels').array().default(['']).notNull(),
    enabled: boolean().default(true).notNull(),
    createdAt: timestamp('created_at', { mode: 'string' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow().notNull(),
  },
  (table) => [
    index('linear_project_repo_mapping_linear_project_idx').using(
      'btree',
      table.linearProjectId.asc().nullsLast().op('int4_ops'),
    ),
    index('linear_project_repo_mapping_project_idx').using(
      'btree',
      table.projectId.asc().nullsLast().op('int4_ops'),
    ),
    index('linear_project_repo_mapping_repository_idx').using(
      'btree',
      table.repositoryId.asc().nullsLast().op('int8_ops'),
    ),
    uniqueIndex('linear_project_repo_mapping_unique').using(
      'btree',
      table.projectId.asc().nullsLast().op('int4_ops'),
      table.linearProjectId.asc().nullsLast().op('int4_ops'),
    ),
    foreignKey({
      columns: [table.projectId],
      foreignColumns: [project.id],
      name: 'linear_project_repo_mapping_project_id_project_id_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.repositoryId],
      foreignColumns: [repository.id],
      name: 'linear_project_repo_mapping_repository_id_repository_id_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.linearProjectId],
      foreignColumns: [linearProject.id],
      name: 'linear_project_repo_mapping_linear_project_id_linear_project_id',
    }).onDelete('cascade'),
  ],
);

export const linearProject = pgTable(
  'linear_project',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity({
      name: 'linear_project_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    projectId: integer('project_id').notNull(),
    teamId: integer('team_id').notNull(),
    linearId: text('linear_id').notNull(),
    name: text().notNull(),
    description: text(),
    state: text(),
    progress: numeric({ precision: 5, scale: 4 }),
    targetDate: timestamp('target_date', { mode: 'string' }),
    rawJson: text('raw_json').notNull(),
    syncedAt: timestamp('synced_at', { mode: 'string' }).defaultNow().notNull(),
    createdAt: timestamp('created_at', { mode: 'string' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('linear_project_project_linear_id_unique').using(
      'btree',
      table.projectId.asc().nullsLast().op('int4_ops'),
      table.linearId.asc().nullsLast().op('int4_ops'),
    ),
    index('linear_project_team_idx').using('btree', table.teamId.asc().nullsLast().op('int4_ops')),
    foreignKey({
      columns: [table.projectId],
      foreignColumns: [project.id],
      name: 'linear_project_project_id_project_id_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.teamId],
      foreignColumns: [linearTeam.id],
      name: 'linear_project_team_id_linear_team_id_fk',
    }).onDelete('cascade'),
  ],
);

export const linearComment = pgTable(
  'linear_comment',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity({
      name: 'linear_comment_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    projectId: integer('project_id').notNull(),
    issueId: integer('issue_id').notNull(),
    linearId: text('linear_id').notNull(),
    body: text().notNull(),
    userId: text('user_id'),
    userName: text('user_name'),
    rawJson: text('raw_json').notNull(),
    linearCreatedAt: timestamp('linear_created_at', { mode: 'string' }),
    linearUpdatedAt: timestamp('linear_updated_at', { mode: 'string' }).notNull(),
    syncedAt: timestamp('synced_at', { mode: 'string' }).defaultNow().notNull(),
    createdAt: timestamp('created_at', { mode: 'string' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow().notNull(),
  },
  (table) => [
    index('linear_comment_issue_idx').using(
      'btree',
      table.issueId.asc().nullsLast().op('int4_ops'),
    ),
    uniqueIndex('linear_comment_project_linear_id_unique').using(
      'btree',
      table.projectId.asc().nullsLast().op('int4_ops'),
      table.linearId.asc().nullsLast().op('int4_ops'),
    ),
    foreignKey({
      columns: [table.projectId],
      foreignColumns: [project.id],
      name: 'linear_comment_project_id_project_id_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.issueId],
      foreignColumns: [linearIssue.id],
      name: 'linear_comment_issue_id_linear_issue_id_fk',
    }).onDelete('cascade'),
  ],
);

export const linearLabel = pgTable(
  'linear_label',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity({
      name: 'linear_label_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    projectId: integer('project_id').notNull(),
    teamId: integer('team_id'),
    linearId: text('linear_id').notNull(),
    name: text().notNull(),
    color: text(),
    description: text(),
    isGroup: boolean('is_group').default(false),
    parentId: text('parent_id'),
    rawJson: text('raw_json').notNull(),
    syncedAt: timestamp('synced_at', { mode: 'string' }).defaultNow().notNull(),
    createdAt: timestamp('created_at', { mode: 'string' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('linear_label_project_linear_id_unique').using(
      'btree',
      table.projectId.asc().nullsLast().op('int4_ops'),
      table.linearId.asc().nullsLast().op('int4_ops'),
    ),
    index('linear_label_team_idx').using('btree', table.teamId.asc().nullsLast().op('int4_ops')),
    foreignKey({
      columns: [table.projectId],
      foreignColumns: [project.id],
      name: 'linear_label_project_id_project_id_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.teamId],
      foreignColumns: [linearTeam.id],
      name: 'linear_label_team_id_linear_team_id_fk',
    }).onDelete('cascade'),
  ],
);

export const projectLinearSettings = pgTable(
  'project_linear_settings',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity({
      name: 'project_linear_settings_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    projectId: integer('project_id').notNull(),
    linearTeamId: text('linear_team_id').notNull(),
    linearProjectId: text('linear_project_id'),
    defaultLabelIds: jsonb('default_label_ids').default([]).notNull(),
    defaultStateId: text('default_state_id'),
    defaultTemplateId: text('default_template_id'),
    createdAt: timestamp('created_at', { mode: 'string' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('project_linear_settings_project_unique').using(
      'btree',
      table.projectId.asc().nullsLast().op('int4_ops'),
    ),
    index('project_linear_settings_team_idx').using(
      'btree',
      table.linearTeamId.asc().nullsLast().op('text_ops'),
    ),
    foreignKey({
      columns: [table.projectId],
      foreignColumns: [project.id],
      name: 'project_linear_settings_project_id_project_id_fk',
    }).onDelete('cascade'),
  ],
);

export const userApiKey = pgTable(
  'user_api_key',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity({
      name: 'user_api_key_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    userId: integer('user_id').notNull(),
    name: varchar({ length: 255 }).notNull(),
    description: text(),
    keyHash: varchar('key_hash', { length: 64 }).notNull(),
    keyPrefix: varchar('key_prefix', { length: 16 }).notNull(),
    expiresAt: timestamp('expires_at', { mode: 'string' }),
    revokedAt: timestamp('revoked_at', { mode: 'string' }),
    createdAt: timestamp('created_at', { mode: 'string' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow().notNull(),
  },
  (table) => [
    index('user_api_key_prefix_active_idx')
      .using('btree', table.keyPrefix.asc().nullsLast().op('text_ops'))
      .where(sql`(revoked_at IS NULL)`),
    index('user_api_key_user_id_id_idx').using(
      'btree',
      table.userId.asc().nullsLast().op('int4_ops'),
      table.id.asc().nullsLast().op('int4_ops'),
    ),
    index('user_api_key_user_id_revoked_at_idx').using(
      'btree',
      table.userId.asc().nullsLast().op('int4_ops'),
      table.revokedAt.asc().nullsLast().op('timestamp_ops'),
    ),
    index('user_api_key_user_idx').using('btree', table.userId.asc().nullsLast().op('int4_ops')),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [user.id],
      name: 'user_api_key_user_id_user_id_fk',
    }).onDelete('cascade'),
    unique('user_api_key_key_prefix_unique').on(table.keyPrefix),
    check('user_api_key_prefix_format', sql`(key_prefix)::text ~ '^uak_[0-9a-f]{12}$'::text`),
    check('user_api_key_name_not_empty', sql`length(TRIM(BOTH FROM name)) > 0`),
  ],
);

export const linearWebhookDelivery = pgTable(
  'linear_webhook_delivery',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity({
      name: 'linear_webhook_delivery_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    deliveryId: text('delivery_id').notNull(),
    resourceType: text('resource_type').notNull(),
    action: text().notNull(),
    resourceId: text('resource_id').notNull(),
    workspaceIntegrationId: integer('workspace_integration_id'),
    processedAt: timestamp('processed_at', { mode: 'string' }).defaultNow().notNull(),
  },
  (table) => [
    index('linear_webhook_delivery_processed_idx').using(
      'btree',
      table.processedAt.asc().nullsLast().op('timestamp_ops'),
    ),
    uniqueIndex('linear_webhook_delivery_unique').using(
      'btree',
      table.deliveryId.asc().nullsLast().op('text_ops'),
    ),
    foreignKey({
      columns: [table.workspaceIntegrationId],
      foreignColumns: [workspaceIntegration.id],
      name: 'linear_webhook_delivery_workspace_integration_id_workspace_inte',
    }).onDelete('set null'),
  ],
);

export const platformAdminAuditLog = pgTable(
  'platform_admin_audit_log',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity({
      name: 'platform_admin_audit_log_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    userId: integer('user_id').notNull(),
    performedBy: integer('performed_by'),
    action: platformAdminAction().notNull(),
    reason: text().notNull(),
    createdAt: timestamp('created_at', { mode: 'string' }).defaultNow().notNull(),
  },
  (table) => [
    index('platform_admin_audit_log_created_at_idx').using(
      'btree',
      table.createdAt.asc().nullsLast().op('timestamp_ops'),
    ),
    index('platform_admin_audit_log_performed_by_idx').using(
      'btree',
      table.performedBy.asc().nullsLast().op('int4_ops'),
    ),
    index('platform_admin_audit_log_user_idx').using(
      'btree',
      table.userId.asc().nullsLast().op('int4_ops'),
    ),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [user.id],
      name: 'platform_admin_audit_log_user_id_user_id_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.performedBy],
      foreignColumns: [user.id],
      name: 'platform_admin_audit_log_performed_by_user_id_fk',
    }).onDelete('set null'),
  ],
);

export const workflowConfig = pgTable(
  'workflow_config',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity({
      name: 'workflow_config_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    workspaceId: integer('workspace_id').notNull(),
    maxConcurrentWorkflows: integer('max_concurrent_workflows').default(3).notNull(),
    workflowTimeoutMinutes: integer('workflow_timeout_minutes').default(30).notNull(),
    agentTurnLimit: integer('agent_turn_limit').default(50).notNull(),
    tokenBudgetPerWorkflow: integer('token_budget_per_workflow').default(100000).notNull(),
    maxToolCalls: integer('max_tool_calls').default(200).notNull(),
    maxFilesModified: integer('max_files_modified').default(50).notNull(),
    validationCommand: text('validation_command'),
    validationTimeoutMinutes: integer('validation_timeout_minutes').default(5).notNull(),
    autoTriggerOnReview: boolean('auto_trigger_on_review').default(false).notNull(),
    requireApprovalForImplementation: boolean('require_approval_for_implementation')
      .default(true)
      .notNull(),
    pushConflictPolicy: pushConflictPolicy('push_conflict_policy').default('abort').notNull(),
    prAssistEnabled: boolean('pr_assist_enabled').default(false).notNull(),
    allowDraftPrs: boolean('allow_draft_prs').default(false).notNull(),
    autoResolveReviewThreads: boolean('auto_resolve_review_threads').default(false).notNull(),
    resolveConfidenceThreshold: numeric('resolve_confidence_threshold', { precision: 3, scale: 2 })
      .default('0.80')
      .notNull(),
    attemptLimitPerPr: integer('attempt_limit_per_pr').default(5).notNull(),
    attemptLimitPerSignature: integer('attempt_limit_per_signature').default(2).notNull(),
    backoffBaseMinutes: integer('backoff_base_minutes').default(5).notNull(),
    branchUpdateStrategy: branchUpdateStrategy('branch_update_strategy').default('merge').notNull(),
    retentionDays: integer('retention_days').default(90).notNull(),
    autoDeleteEnabled: boolean('auto_delete_enabled').default(false).notNull(),
    createdAt: timestamp('created_at', { mode: 'string' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow().notNull(),
    prReviewEnabled: boolean('pr_review_enabled').default(true).notNull(),
  },
  (table) => [
    index('workflow_config_workspace_idx').using(
      'btree',
      table.workspaceId.asc().nullsLast().op('int4_ops'),
    ),
    foreignKey({
      columns: [table.workspaceId],
      foreignColumns: [workspace.id],
      name: 'workflow_config_workspace_id_workspace_id_fk',
    }).onDelete('cascade'),
    unique('workflow_config_workspace_id_unique').on(table.workspaceId),
    check(
      'workflow_config_timeout_range',
      sql`(workflow_timeout_minutes >= 1) AND (workflow_timeout_minutes <= 60)`,
    ),
    check(
      'workflow_config_turn_limit_range',
      sql`(agent_turn_limit >= 1) AND (agent_turn_limit <= 100)`,
    ),
    check(
      'workflow_config_token_budget_range',
      sql`(token_budget_per_workflow >= 1000) AND (token_budget_per_workflow <= 500000)`,
    ),
    check(
      'workflow_config_tool_calls_range',
      sql`(max_tool_calls >= 10) AND (max_tool_calls <= 500)`,
    ),
    check(
      'workflow_config_files_modified_range',
      sql`(max_files_modified >= 1) AND (max_files_modified <= 100)`,
    ),
    check(
      'workflow_config_validation_timeout_range',
      sql`(validation_timeout_minutes >= 1) AND (validation_timeout_minutes <= 10)`,
    ),
    check(
      'workflow_config_concurrent_range',
      sql`(max_concurrent_workflows >= 1) AND (max_concurrent_workflows <= 10)`,
    ),
    check(
      'workflow_config_retention_days_range',
      sql`(retention_days >= 1) AND (retention_days <= 3650)`,
    ),
    check(
      'workflow_config_attempt_limit_per_pr_range',
      sql`(attempt_limit_per_pr >= 1) AND (attempt_limit_per_pr <= 50)`,
    ),
    check(
      'workflow_config_attempt_limit_per_signature_range',
      sql`(attempt_limit_per_signature >= 1) AND (attempt_limit_per_signature <= 10)`,
    ),
    check(
      'workflow_config_backoff_base_minutes_range',
      sql`(backoff_base_minutes >= 1) AND (backoff_base_minutes <= 60)`,
    ),
  ],
);

export const workflowRun = pgTable(
  'workflow_run',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    workflowId: text('workflow_id').notNull(),
    runId: text('run_id'),
    workspaceId: integer('workspace_id').notNull(),
    // You can use { mode: "bigint" } if numbers are exceeding js number limitations
    repositoryId: bigint('repository_id', { mode: 'number' }),
    pullRequestNumber: integer('pull_request_number'),
    taskType: workflowTaskType('task_type').notNull(),
    triggerSource: text('trigger_source').notNull(),
    triggerMetadata: jsonb('trigger_metadata'),
    phase: workflowPhase().default('pending').notNull(),
    templateAlias: text('template_alias'),
    templateId: text('template_id'),
    envdVersion: text('envd_version'),
    filesChanged: text('files_changed').array(),
    commitSha: text('commit_sha'),
    tokensUsed: integer('tokens_used').default(0),
    costUsd: numeric('cost_usd', { precision: 10, scale: 4 }).default('0'),
    errorMessage: text('error_message'),
    errorCategory: errorCategory('error_category'),
    startedAt: timestamp('started_at', { mode: 'string' }),
    completedAt: timestamp('completed_at', { mode: 'string' }),
    createdAt: timestamp('created_at', { mode: 'string' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow().notNull(),
    errorCode: text('error_code'),
    retryOfWorkflowId: text('retry_of_workflow_id'),
    commits: jsonb(),
    validationWarning: boolean('validation_warning').default(false),
    resolutionArtifact: jsonb('resolution_artifact'),
    artifacts: jsonb(),
    // You can use { mode: "bigint" } if numbers are exceeding js number limitations
    triggerActorId: bigint('trigger_actor_id', { mode: 'number' }),
    triggerActorLogin: text('trigger_actor_login'),
    triggeredByUserId: integer('triggered_by_user_id'),
    cancellationReason: text('cancellation_reason'),
    orchestratorWorkflowId: text('orchestrator_workflow_id'),
    triggerId: integer('trigger_id'),
  },
  (table) => [
    index('workflow_run_error_code_idx').using(
      'btree',
      table.errorCode.asc().nullsLast().op('text_ops'),
    ),
    index('workflow_run_repository_phase_idx').using(
      'btree',
      table.repositoryId.asc().nullsLast().op('int8_ops'),
      table.phase.asc().nullsLast().op('int8_ops'),
    ),
    index('workflow_run_retry_of_idx').using(
      'btree',
      table.retryOfWorkflowId.asc().nullsLast().op('text_ops'),
    ),
    uniqueIndex('workflow_run_workflow_id_idx').using(
      'btree',
      table.workflowId.asc().nullsLast().op('text_ops'),
    ),
    index('workflow_run_workspace_created_idx').using(
      'btree',
      table.workspaceId.asc().nullsLast().op('int4_ops'),
      table.createdAt.asc().nullsLast().op('timestamp_ops'),
    ),
    index('workflow_run_workspace_phase_idx').using(
      'btree',
      table.workspaceId.asc().nullsLast().op('enum_ops'),
      table.phase.asc().nullsLast().op('enum_ops'),
    ),
    foreignKey({
      columns: [table.workspaceId],
      foreignColumns: [workspace.id],
      name: 'workflow_run_workspace_id_workspace_id_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.repositoryId],
      foreignColumns: [repository.id],
      name: 'workflow_run_repository_id_repository_id_fk',
    }).onDelete('set null'),
    foreignKey({
      columns: [table.triggeredByUserId],
      foreignColumns: [user.id],
      name: 'workflow_run_triggered_by_user_id_user_id_fk',
    }).onDelete('set null'),
    foreignKey({
      columns: [table.triggerId],
      foreignColumns: [pullRequestTrigger.id],
      name: 'workflow_run_trigger_id_pull_request_trigger_id_fk',
    }).onDelete('set null'),
  ],
);

export const workflowIssueReference = pgTable(
  'workflow_issue_reference',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity({
      name: 'workflow_issue_reference_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    workflowRunId: uuid('workflow_run_id').notNull(),
    type: issueReferenceType().notNull(),
    issueId: text('issue_id').notNull(),
    issueKey: text('issue_key'),
    issueUrl: text('issue_url'),
    title: text(),
    status: text(),
    createdAt: timestamp('created_at', { mode: 'string' }).defaultNow().notNull(),
  },
  (table) => [
    index('workflow_issue_reference_run_idx').using(
      'btree',
      table.workflowRunId.asc().nullsLast().op('uuid_ops'),
    ),
    index('workflow_issue_reference_type_issue_idx').using(
      'btree',
      table.type.asc().nullsLast().op('text_ops'),
      table.issueId.asc().nullsLast().op('text_ops'),
    ),
    uniqueIndex('workflow_issue_reference_unique').using(
      'btree',
      table.workflowRunId.asc().nullsLast().op('text_ops'),
      table.type.asc().nullsLast().op('text_ops'),
      table.issueId.asc().nullsLast().op('text_ops'),
    ),
    foreignKey({
      columns: [table.workflowRunId],
      foreignColumns: [workflowRun.id],
      name: 'workflow_issue_reference_workflow_run_id_workflow_run_id_fk',
    }).onDelete('cascade'),
  ],
);

export const claudeSession = pgTable(
  'claude_session',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    workflowId: text('workflow_id'),
    sessionId: text('session_id').notNull(),
    projectPath: text('project_path').notNull(),
    content: text().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('claude_session_workflow_session_idx').using(
      'btree',
      table.workflowId.asc().nullsLast().op('text_ops'),
      table.sessionId.asc().nullsLast().op('text_ops'),
    ),
    foreignKey({
      columns: [table.workflowId],
      foreignColumns: [pipelineRun.workflowId],
      name: 'claude_session_workflow_id_pipeline_run_workflow_id_fk',
    }).onDelete('cascade'),
  ],
);

export const draftVersion = pgTable(
  'draft_version',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    workflowId: text('workflow_id').notNull(),
    phaseId: text('phase_id').notNull(),
    version: text().notNull(),
    triggeredBy: draftTriggeredBy('triggered_by').notNull(),
    feedback: text(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
    approvedAt: timestamp('approved_at', { withTimezone: true, mode: 'string' }),
  },
  (table) => [
    uniqueIndex('draft_version_workflow_phase_version_idx').using(
      'btree',
      table.workflowId.asc().nullsLast().op('text_ops'),
      table.phaseId.asc().nullsLast().op('text_ops'),
      table.version.asc().nullsLast().op('text_ops'),
    ),
    foreignKey({
      columns: [table.workflowId],
      foreignColumns: [pipelineRun.workflowId],
      name: 'draft_version_workflow_id_pipeline_run_workflow_id_fk',
    }).onDelete('cascade'),
  ],
);

export const phaseTemplate = pgTable(
  'phase_template',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    slug: text().notNull(),
    name: text().notNull(),
    description: text(),
    category: phaseTemplateCategory().notNull(),
    defaultPrompt: text('default_prompt').notNull(),
    promptPrefix: text('prompt_prefix'),
    promptSuffix: text('prompt_suffix'),
    outputSchema: jsonb('output_schema'),
    fileExtension: text('file_extension').default('json').notNull(),
    outputContext: text('output_context'),
    defaultPopulatesField: text('default_populates_field'),
    hasCustomExecute: boolean('has_custom_execute').default(false).notNull(),
    isBuiltIn: boolean('is_built_in').default(false).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
  },
  (table) => [unique('phase_template_slug_unique').on(table.slug)],
);

export const pipelineRun = pgTable(
  'pipeline_run',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    workflowId: text('workflow_id').notNull(),
    pipelineId: uuid('pipeline_id'),
    status: pipelineRunStatus().notNull(),
    input: jsonb().notNull(),
    output: jsonb(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true, mode: 'string' }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true, mode: 'string' }),
  },
  (table) => [
    index('pipeline_run_pipeline_id_idx').using(
      'btree',
      table.pipelineId.asc().nullsLast().op('uuid_ops'),
    ),
    foreignKey({
      columns: [table.pipelineId],
      foreignColumns: [pipeline.id],
      name: 'pipeline_run_pipeline_id_pipeline_id_fk',
    }).onDelete('set null'),
    unique('pipeline_run_workflow_id_unique').on(table.workflowId),
  ],
);

export const phaseExecution = pgTable(
  'phase_execution',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    workflowId: text('workflow_id').notNull(),
    phaseId: text('phase_id').notNull(),
    status: phaseExecutionStatus().notNull(),
    isDraftable: boolean('is_draftable').default(false).notNull(),
    startedAt: timestamp('started_at', { withTimezone: true, mode: 'string' }),
    completedAt: timestamp('completed_at', { withTimezone: true, mode: 'string' }),
    sessionId: text('session_id'),
    artifactPath: text('artifact_path'),
    draftState: jsonb('draft_state'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('phase_execution_workflow_id_idx').using(
      'btree',
      table.workflowId.asc().nullsLast().op('text_ops'),
    ),
    uniqueIndex('phase_execution_workflow_phase_idx').using(
      'btree',
      table.workflowId.asc().nullsLast().op('text_ops'),
      table.phaseId.asc().nullsLast().op('text_ops'),
    ),
    foreignKey({
      columns: [table.workflowId],
      foreignColumns: [pipelineRun.workflowId],
      name: 'phase_execution_workflow_id_pipeline_run_workflow_id_fk',
    }).onDelete('cascade'),
  ],
);

export const pipeline = pgTable(
  'pipeline',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    slug: text().notNull(),
    name: text().notNull(),
    description: text(),
    phases: jsonb().notNull(),
    groups: jsonb(),
    exports: jsonb().default([]).notNull(),
    inputSchema: jsonb('input_schema'),
    isBuiltIn: boolean('is_built_in').default(false).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
    pipelineOutputSchemaId: uuid('pipeline_output_schema_id'),
    fieldMapping: jsonb('field_mapping'),
    isEnabled: boolean('is_enabled').default(true).notNull(),
  },
  (table) => [
    index('pipeline_is_enabled_idx').using(
      'btree',
      table.isEnabled.asc().nullsLast().op('bool_ops'),
    ),
    foreignKey({
      columns: [table.pipelineOutputSchemaId],
      foreignColumns: [pipelineOutputSchema.id],
      name: 'pipeline_pipeline_output_schema_id_pipeline_output_schema_id_fk',
    }).onDelete('set null'),
    unique('pipeline_slug_unique').on(table.slug),
  ],
);

export const pipelineArtifact = pgTable(
  'pipeline_artifact',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    workflowId: text('workflow_id').notNull(),
    phaseId: text('phase_id').notNull(),
    version: text().default('1').notNull(),
    content: text().notNull(),
    fileExtension: text('file_extension').default('json').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('pipeline_artifact_workflow_id_idx').using(
      'btree',
      table.workflowId.asc().nullsLast().op('text_ops'),
    ),
    uniqueIndex('pipeline_artifact_workflow_phase_version_idx').using(
      'btree',
      table.workflowId.asc().nullsLast().op('text_ops'),
      table.phaseId.asc().nullsLast().op('text_ops'),
      table.version.asc().nullsLast().op('text_ops'),
    ),
    foreignKey({
      columns: [table.workflowId],
      foreignColumns: [pipelineRun.workflowId],
      name: 'pipeline_artifact_workflow_id_pipeline_run_workflow_id_fk',
    }).onDelete('cascade'),
  ],
);

export const analysisContext = pgTable(
  'analysis_context',
  {
    workflowId: text('workflow_id').primaryKey().notNull(),
    projectId: integer('project_id').notNull(),
    pipelineId: uuid('pipeline_id'),
    pipelineSlug: text('pipeline_slug').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('analysis_context_project_idx').using(
      'btree',
      table.projectId.asc().nullsLast().op('int4_ops'),
    ),
    index('analysis_context_project_pipeline_slug_idx').using(
      'btree',
      table.projectId.asc().nullsLast().op('int4_ops'),
      table.pipelineSlug.asc().nullsLast().op('int4_ops'),
    ),
    foreignKey({
      columns: [table.projectId],
      foreignColumns: [project.id],
      name: 'analysis_context_project_id_project_id_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.pipelineId],
      foreignColumns: [pipeline.id],
      name: 'analysis_context_pipeline_id_pipeline_id_fk',
    }).onDelete('set null'),
  ],
);

export const pullRequestTrigger = pgTable(
  'pull_request_trigger',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity({
      name: 'pull_request_trigger_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    // You can use { mode: "bigint" } if numbers are exceeding js number limitations
    repositoryId: bigint('repository_id', { mode: 'number' }).notNull(),
    prNumber: integer('pr_number').notNull(),
    triggerType: pullRequestTriggerType('trigger_type').notNull(),
    headSha: text('head_sha').notNull(),
    signature: text().notNull(),
    // You can use { mode: "bigint" } if numbers are exceeding js number limitations
    installationId: bigint('installation_id', { mode: 'number' }).notNull(),
    workspaceId: integer('workspace_id').notNull(),
    status: pullRequestTriggerStatus().default('pending').notNull(),
    orchestratorWorkflowId: text('orchestrator_workflow_id'),
    childWorkflowId: text('child_workflow_id'),
    triggeredByUserId: integer('triggered_by_user_id'),
    triggerActorLogin: text('trigger_actor_login'),
    attemptCount: integer('attempt_count').default(0).notNull(),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true, mode: 'string' }),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
    processedAt: timestamp('processed_at', { withTimezone: true, mode: 'string' }),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('pull_request_trigger_dedupe_idx').using(
      'btree',
      table.repositoryId.asc().nullsLast().op('enum_ops'),
      table.prNumber.asc().nullsLast().op('int4_ops'),
      table.headSha.asc().nullsLast().op('text_ops'),
      table.triggerType.asc().nullsLast().op('int4_ops'),
      table.signature.asc().nullsLast().op('int4_ops'),
    ),
    index('pull_request_trigger_next_attempt_idx').using(
      'btree',
      table.status.asc().nullsLast().op('enum_ops'),
      table.nextAttemptAt.asc().nullsLast().op('enum_ops'),
    ),
    index('pull_request_trigger_repo_pr_idx').using(
      'btree',
      table.repositoryId.asc().nullsLast().op('int8_ops'),
      table.prNumber.asc().nullsLast().op('int4_ops'),
    ),
    index('pull_request_trigger_status_idx').using(
      'btree',
      table.status.asc().nullsLast().op('enum_ops'),
    ),
    foreignKey({
      columns: [table.repositoryId],
      foreignColumns: [repository.id],
      name: 'pull_request_trigger_repository_id_repository_id_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.workspaceId],
      foreignColumns: [workspace.id],
      name: 'pull_request_trigger_workspace_id_workspace_id_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.installationId],
      foreignColumns: [githubInstallation.installationId],
      name: 'pull_request_trigger_installation_id_github_installation_instal',
    }).onDelete('cascade'),
  ],
);

export const pipelineOutputSchema = pgTable(
  'pipeline_output_schema',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    slug: text().notNull(),
    name: text().notNull(),
    description: text(),
    jsonSchema: jsonb('json_schema').notNull(),
    isBuiltIn: boolean('is_built_in').default(false).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
  },
  (table) => [unique('pipeline_output_schema_slug_unique').on(table.slug)],
);

export const pullRequestState = pgTable(
  'pull_request_state',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity({
      name: 'pull_request_state_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    // You can use { mode: "bigint" } if numbers are exceeding js number limitations
    repositoryId: bigint('repository_id', { mode: 'number' }).notNull(),
    prNumber: integer('pr_number').notNull(),
    state: text().default('open').notNull(),
    isDraft: boolean('is_draft').default(false).notNull(),
    isMerged: boolean('is_merged').default(false).notNull(),
    headSha: text('head_sha'),
    baseSha: text('base_sha'),
    baseRef: text('base_ref'),
    ciStatus: ciStatus('ci_status').default('unknown').notNull(),
    failingCheckCount: integer('failing_check_count').default(0).notNull(),
    ciUpdatedAt: timestamp('ci_updated_at', { mode: 'string' }),
    reviewStatus: reviewStatus('review_status').default('unknown').notNull(),
    approvalCount: integer('approval_count').default(0).notNull(),
    changesRequestedCount: integer('changes_requested_count').default(0).notNull(),
    unresolvedThreadCount: integer('unresolved_thread_count').default(0).notNull(),
    reviewUpdatedAt: timestamp('review_updated_at', { mode: 'string' }),
    mergeStatus: mergeStatus('merge_status').default('unknown').notNull(),
    mergeUpdatedAt: timestamp('merge_updated_at', { mode: 'string' }),
    automationStatus: automationStatus('automation_status').default('idle').notNull(),
    attemptCount: integer('attempt_count').default(0).notNull(),
    lastErrorMessage: text('last_error_message'),
    lastTriggerSignature: text('last_trigger_signature'),
    signatureAttemptCount: integer('signature_attempt_count').default(0).notNull(),
    lastAttemptAt: timestamp('last_attempt_at', { mode: 'string' }),
    isPaused: boolean('is_paused').default(false).notNull(),
    prUpdatedAt: timestamp('pr_updated_at', { mode: 'string' }),
    createdAt: timestamp('created_at', { mode: 'string' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow().notNull(),
  },
  (table) => [
    index('pull_request_state_automation_idx').using(
      'btree',
      table.automationStatus.asc().nullsLast().op('enum_ops'),
    ),
    index('pull_request_state_repo_automation_idx').using(
      'btree',
      table.repositoryId.asc().nullsLast().op('int8_ops'),
      table.automationStatus.asc().nullsLast().op('enum_ops'),
    ),
    uniqueIndex('pull_request_state_repo_pr_idx').using(
      'btree',
      table.repositoryId.asc().nullsLast().op('int8_ops'),
      table.prNumber.asc().nullsLast().op('int8_ops'),
    ),
    foreignKey({
      columns: [table.repositoryId],
      foreignColumns: [repository.id],
      name: 'pull_request_state_repository_id_repository_id_fk',
    }).onDelete('cascade'),
  ],
);

export const analysisCapability = pgTable(
  'analysis_capability',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity({
      name: 'analysis_capability_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    workspaceId: integer('workspace_id').notNull(),
    projectId: integer('project_id').notNull(),
    capabilityKey: text('capability_key').notNull(),
    currentVersionNumber: integer('current_version_number').default(1).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('analysis_capability_project_idx').using(
      'btree',
      table.projectId.asc().nullsLast().op('int4_ops'),
    ),
    uniqueIndex('analysis_capability_project_key_idx').using(
      'btree',
      table.projectId.asc().nullsLast().op('int4_ops'),
      table.capabilityKey.asc().nullsLast().op('int4_ops'),
    ),
    foreignKey({
      columns: [table.workspaceId],
      foreignColumns: [workspace.id],
      name: 'analysis_capability_workspace_id_workspace_id_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.projectId],
      foreignColumns: [project.id],
      name: 'analysis_capability_project_id_project_id_fk',
    }).onDelete('cascade'),
  ],
);

export const analysisArchitecture = pgTable(
  'analysis_architecture',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity({
      name: 'analysis_architecture_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    workspaceId: integer('workspace_id').notNull(),
    projectId: integer('project_id').notNull(),
    currentVersionNumber: integer('current_version_number').default(1).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('analysis_architecture_project_idx').using(
      'btree',
      table.projectId.asc().nullsLast().op('int4_ops'),
    ),
    foreignKey({
      columns: [table.workspaceId],
      foreignColumns: [workspace.id],
      name: 'analysis_architecture_workspace_id_workspace_id_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.projectId],
      foreignColumns: [project.id],
      name: 'analysis_architecture_project_id_project_id_fk',
    }).onDelete('cascade'),
  ],
);

export const analysisArchitectureVersion = pgTable(
  'analysis_architecture_version',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity({
      name: 'analysis_architecture_version_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    architectureId: integer('architecture_id').notNull(),
    versionNumber: integer('version_number').notNull(),
    pipelineRunId: text('pipeline_run_id'),
    content: jsonb().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('analysis_architecture_version_arch_idx').using(
      'btree',
      table.architectureId.asc().nullsLast().op('int4_ops'),
    ),
    index('analysis_architecture_version_run_idx').using(
      'btree',
      table.pipelineRunId.asc().nullsLast().op('text_ops'),
    ),
    uniqueIndex('analysis_architecture_version_unique_idx').using(
      'btree',
      table.architectureId.asc().nullsLast().op('int4_ops'),
      table.versionNumber.asc().nullsLast().op('int4_ops'),
    ),
    foreignKey({
      columns: [table.architectureId],
      foreignColumns: [analysisArchitecture.id],
      name: 'analysis_architecture_version_architecture_id_analysis_architec',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.pipelineRunId],
      foreignColumns: [pipelineRun.workflowId],
      name: 'analysis_architecture_version_pipeline_run_id_pipeline_run_work',
    }).onDelete('set null'),
  ],
);

export const analysisConnectedRepo = pgTable(
  'analysis_connected_repo',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity({
      name: 'analysis_connected_repo_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    workspaceId: integer('workspace_id').notNull(),
    projectId: integer('project_id').notNull(),
    name: text().notNull(),
    currentVersionNumber: integer('current_version_number').default(1).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('analysis_connected_repo_project_idx').using(
      'btree',
      table.projectId.asc().nullsLast().op('int4_ops'),
    ),
    uniqueIndex('analysis_connected_repo_project_name_idx').using(
      'btree',
      table.projectId.asc().nullsLast().op('int4_ops'),
      table.name.asc().nullsLast().op('int4_ops'),
    ),
    foreignKey({
      columns: [table.workspaceId],
      foreignColumns: [workspace.id],
      name: 'analysis_connected_repo_workspace_id_workspace_id_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.projectId],
      foreignColumns: [project.id],
      name: 'analysis_connected_repo_project_id_project_id_fk',
    }).onDelete('cascade'),
  ],
);

export const analysisConnectedRepoVersion = pgTable(
  'analysis_connected_repo_version',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity({
      name: 'analysis_connected_repo_version_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    connectedRepoId: integer('connected_repo_id').notNull(),
    versionNumber: integer('version_number').notNull(),
    pipelineRunId: text('pipeline_run_id'),
    content: jsonb().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('analysis_connected_repo_version_cr_idx').using(
      'btree',
      table.connectedRepoId.asc().nullsLast().op('int4_ops'),
    ),
    index('analysis_connected_repo_version_run_idx').using(
      'btree',
      table.pipelineRunId.asc().nullsLast().op('text_ops'),
    ),
    uniqueIndex('analysis_connected_repo_version_unique_idx').using(
      'btree',
      table.connectedRepoId.asc().nullsLast().op('int4_ops'),
      table.versionNumber.asc().nullsLast().op('int4_ops'),
    ),
    foreignKey({
      columns: [table.connectedRepoId],
      foreignColumns: [analysisConnectedRepo.id],
      name: 'analysis_connected_repo_version_connected_repo_id_analysis_conn',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.pipelineRunId],
      foreignColumns: [pipelineRun.workflowId],
      name: 'analysis_connected_repo_version_pipeline_run_id_pipeline_run_wo',
    }).onDelete('set null'),
  ],
);

export const analysisContextArtifact = pgTable(
  'analysis_context_artifact',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity({
      name: 'analysis_context_artifact_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    uuid: uuid().defaultRandom().notNull(),
    workspaceId: integer('workspace_id').notNull(),
    projectId: integer('project_id').notNull(),
    originatingPrompt: text('originating_prompt').notNull(),
    originatingSessionId: text('originating_session_id'),
    content: jsonb().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('analysis_context_artifact_project_idx').using(
      'btree',
      table.projectId.asc().nullsLast().op('int4_ops'),
    ),
    index('analysis_context_artifact_session_idx').using(
      'btree',
      table.originatingSessionId.asc().nullsLast().op('text_ops'),
    ),
    foreignKey({
      columns: [table.workspaceId],
      foreignColumns: [workspace.id],
      name: 'analysis_context_artifact_workspace_id_workspace_id_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.projectId],
      foreignColumns: [project.id],
      name: 'analysis_context_artifact_project_id_project_id_fk',
    }).onDelete('cascade'),
    unique('analysis_context_artifact_uuid_unique').on(table.uuid),
  ],
);

export const analysisDependency = pgTable(
  'analysis_dependency',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity({
      name: 'analysis_dependency_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    workspaceId: integer('workspace_id').notNull(),
    projectId: integer('project_id').notNull(),
    currentVersionNumber: integer('current_version_number').default(1).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('analysis_dependency_project_idx').using(
      'btree',
      table.projectId.asc().nullsLast().op('int4_ops'),
    ),
    foreignKey({
      columns: [table.workspaceId],
      foreignColumns: [workspace.id],
      name: 'analysis_dependency_workspace_id_workspace_id_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.projectId],
      foreignColumns: [project.id],
      name: 'analysis_dependency_project_id_project_id_fk',
    }).onDelete('cascade'),
  ],
);

export const analysisDeploymentContext = pgTable(
  'analysis_deployment_context',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity({
      name: 'analysis_deployment_context_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    workspaceId: integer('workspace_id').notNull(),
    projectId: integer('project_id').notNull(),
    name: text().notNull(),
    currentVersionNumber: integer('current_version_number').default(1).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('analysis_deployment_ctx_project_idx').using(
      'btree',
      table.projectId.asc().nullsLast().op('int4_ops'),
    ),
    uniqueIndex('analysis_deployment_ctx_project_name_idx').using(
      'btree',
      table.projectId.asc().nullsLast().op('int4_ops'),
      table.name.asc().nullsLast().op('int4_ops'),
    ),
    foreignKey({
      columns: [table.workspaceId],
      foreignColumns: [workspace.id],
      name: 'analysis_deployment_context_workspace_id_workspace_id_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.projectId],
      foreignColumns: [project.id],
      name: 'analysis_deployment_context_project_id_project_id_fk',
    }).onDelete('cascade'),
  ],
);

export const analysisDeploymentContextVersion = pgTable(
  'analysis_deployment_context_version',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity({
      name: 'analysis_deployment_context_version_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    deploymentContextId: integer('deployment_context_id').notNull(),
    versionNumber: integer('version_number').notNull(),
    pipelineRunId: text('pipeline_run_id'),
    name: text().notNull(),
    environment: text().notNull(),
    infrastructure: text().notNull(),
    services: jsonb().default([]).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('analysis_deployment_ctx_version_dc_idx').using(
      'btree',
      table.deploymentContextId.asc().nullsLast().op('int4_ops'),
    ),
    index('analysis_deployment_ctx_version_run_idx').using(
      'btree',
      table.pipelineRunId.asc().nullsLast().op('text_ops'),
    ),
    uniqueIndex('analysis_deployment_ctx_version_unique_idx').using(
      'btree',
      table.deploymentContextId.asc().nullsLast().op('int4_ops'),
      table.versionNumber.asc().nullsLast().op('int4_ops'),
    ),
    foreignKey({
      columns: [table.deploymentContextId],
      foreignColumns: [analysisDeploymentContext.id],
      name: 'analysis_deployment_context_version_deployment_context_id_analy',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.pipelineRunId],
      foreignColumns: [pipelineRun.workflowId],
      name: 'analysis_deployment_context_version_pipeline_run_id_pipeline_ru',
    }).onDelete('set null'),
  ],
);

export const analysisDiagram = pgTable(
  'analysis_diagram',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity({
      name: 'analysis_diagram_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    workspaceId: integer('workspace_id').notNull(),
    projectId: integer('project_id').notNull(),
    currentVersionNumber: integer('current_version_number').default(1).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('analysis_diagram_project_idx').using(
      'btree',
      table.projectId.asc().nullsLast().op('int4_ops'),
    ),
    foreignKey({
      columns: [table.workspaceId],
      foreignColumns: [workspace.id],
      name: 'analysis_diagram_workspace_id_workspace_id_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.projectId],
      foreignColumns: [project.id],
      name: 'analysis_diagram_project_id_project_id_fk',
    }).onDelete('cascade'),
  ],
);

export const analysisCapabilityVersion = pgTable(
  'analysis_capability_version',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity({
      name: 'analysis_capability_version_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    capabilityId: integer('capability_id').notNull(),
    versionNumber: integer('version_number').notNull(),
    pipelineRunId: text('pipeline_run_id'),
    capabilityKey: text('capability_key').notNull(),
    name: text().notNull(),
    description: text().notNull(),
    technicalDetails: text('technical_details').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('analysis_capability_version_capability_idx').using(
      'btree',
      table.capabilityId.asc().nullsLast().op('int4_ops'),
    ),
    index('analysis_capability_version_run_idx').using(
      'btree',
      table.pipelineRunId.asc().nullsLast().op('text_ops'),
    ),
    uniqueIndex('analysis_capability_version_unique_idx').using(
      'btree',
      table.capabilityId.asc().nullsLast().op('int4_ops'),
      table.versionNumber.asc().nullsLast().op('int4_ops'),
    ),
    foreignKey({
      columns: [table.capabilityId],
      foreignColumns: [analysisCapability.id],
      name: 'analysis_capability_version_capability_id_analysis_capability_i',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.pipelineRunId],
      foreignColumns: [pipelineRun.workflowId],
      name: 'analysis_capability_version_pipeline_run_id_pipeline_run_workfl',
    }).onDelete('set null'),
  ],
);

export const analysisDependencyVersion = pgTable(
  'analysis_dependency_version',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity({
      name: 'analysis_dependency_version_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    dependencyId: integer('dependency_id').notNull(),
    versionNumber: integer('version_number').notNull(),
    pipelineRunId: text('pipeline_run_id'),
    content: jsonb().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('analysis_dependency_version_dep_idx').using(
      'btree',
      table.dependencyId.asc().nullsLast().op('int4_ops'),
    ),
    index('analysis_dependency_version_run_idx').using(
      'btree',
      table.pipelineRunId.asc().nullsLast().op('text_ops'),
    ),
    uniqueIndex('analysis_dependency_version_unique_idx').using(
      'btree',
      table.dependencyId.asc().nullsLast().op('int4_ops'),
      table.versionNumber.asc().nullsLast().op('int4_ops'),
    ),
    foreignKey({
      columns: [table.dependencyId],
      foreignColumns: [analysisDependency.id],
      name: 'analysis_dependency_version_dependency_id_analysis_dependency_i',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.pipelineRunId],
      foreignColumns: [pipelineRun.workflowId],
      name: 'analysis_dependency_version_pipeline_run_id_pipeline_run_workfl',
    }).onDelete('set null'),
  ],
);

export const analysisExternalIntegration = pgTable(
  'analysis_external_integration',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity({
      name: 'analysis_external_integration_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    workspaceId: integer('workspace_id').notNull(),
    projectId: integer('project_id').notNull(),
    name: text().notNull(),
    currentVersionNumber: integer('current_version_number').default(1).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('analysis_ext_integration_project_idx').using(
      'btree',
      table.projectId.asc().nullsLast().op('int4_ops'),
    ),
    uniqueIndex('analysis_ext_integration_project_name_idx').using(
      'btree',
      table.projectId.asc().nullsLast().op('int4_ops'),
      table.name.asc().nullsLast().op('int4_ops'),
    ),
    foreignKey({
      columns: [table.workspaceId],
      foreignColumns: [workspace.id],
      name: 'analysis_external_integration_workspace_id_workspace_id_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.projectId],
      foreignColumns: [project.id],
      name: 'analysis_external_integration_project_id_project_id_fk',
    }).onDelete('cascade'),
  ],
);

export const analysisExternalIntegrationVersion = pgTable(
  'analysis_external_integration_version',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity({
      name: 'analysis_external_integration_version_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    externalIntegrationId: integer('external_integration_id').notNull(),
    versionNumber: integer('version_number').notNull(),
    pipelineRunId: text('pipeline_run_id'),
    name: text().notNull(),
    integrationType: text('integration_type').notNull(),
    purpose: text().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('analysis_ext_integration_version_ei_idx').using(
      'btree',
      table.externalIntegrationId.asc().nullsLast().op('int4_ops'),
    ),
    index('analysis_ext_integration_version_run_idx').using(
      'btree',
      table.pipelineRunId.asc().nullsLast().op('text_ops'),
    ),
    uniqueIndex('analysis_ext_integration_version_unique_idx').using(
      'btree',
      table.externalIntegrationId.asc().nullsLast().op('int4_ops'),
      table.versionNumber.asc().nullsLast().op('int4_ops'),
    ),
    foreignKey({
      columns: [table.externalIntegrationId],
      foreignColumns: [analysisExternalIntegration.id],
      name: 'analysis_external_integration_version_external_integration_id_a',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.pipelineRunId],
      foreignColumns: [pipelineRun.workflowId],
      name: 'analysis_external_integration_version_pipeline_run_id_pipeline_',
    }).onDelete('set null'),
  ],
);

export const analysisFeature = pgTable(
  'analysis_feature',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity({
      name: 'analysis_feature_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    workspaceId: integer('workspace_id').notNull(),
    projectId: integer('project_id').notNull(),
    featureKey: text('feature_key').notNull(),
    currentVersionNumber: integer('current_version_number').default(1).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('analysis_feature_project_idx').using(
      'btree',
      table.projectId.asc().nullsLast().op('int4_ops'),
    ),
    uniqueIndex('analysis_feature_project_key_idx').using(
      'btree',
      table.projectId.asc().nullsLast().op('int4_ops'),
      table.featureKey.asc().nullsLast().op('int4_ops'),
    ),
    foreignKey({
      columns: [table.workspaceId],
      foreignColumns: [workspace.id],
      name: 'analysis_feature_workspace_id_workspace_id_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.projectId],
      foreignColumns: [project.id],
      name: 'analysis_feature_project_id_project_id_fk',
    }).onDelete('cascade'),
  ],
);

export const analysisFeatureVersion = pgTable(
  'analysis_feature_version',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity({
      name: 'analysis_feature_version_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    featureId: integer('feature_id').notNull(),
    versionNumber: integer('version_number').notNull(),
    pipelineRunId: text('pipeline_run_id'),
    featureKey: text('feature_key').notNull(),
    name: text().notNull(),
    description: text().notNull(),
    category: text().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('analysis_feature_version_feature_idx').using(
      'btree',
      table.featureId.asc().nullsLast().op('int4_ops'),
    ),
    index('analysis_feature_version_run_idx').using(
      'btree',
      table.pipelineRunId.asc().nullsLast().op('text_ops'),
    ),
    uniqueIndex('analysis_feature_version_unique_idx').using(
      'btree',
      table.featureId.asc().nullsLast().op('int4_ops'),
      table.versionNumber.asc().nullsLast().op('int4_ops'),
    ),
    foreignKey({
      columns: [table.featureId],
      foreignColumns: [analysisFeature.id],
      name: 'analysis_feature_version_feature_id_analysis_feature_id_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.pipelineRunId],
      foreignColumns: [pipelineRun.workflowId],
      name: 'analysis_feature_version_pipeline_run_id_pipeline_run_workflow_',
    }).onDelete('set null'),
  ],
);

export const analysisIntraDependency = pgTable(
  'analysis_intra_dependency',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity({
      name: 'analysis_intra_dependency_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    workspaceId: integer('workspace_id').notNull(),
    projectId: integer('project_id').notNull(),
    currentVersionNumber: integer('current_version_number').default(1).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('analysis_intra_dependency_project_idx').using(
      'btree',
      table.projectId.asc().nullsLast().op('int4_ops'),
    ),
    foreignKey({
      columns: [table.workspaceId],
      foreignColumns: [workspace.id],
      name: 'analysis_intra_dependency_workspace_id_workspace_id_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.projectId],
      foreignColumns: [project.id],
      name: 'analysis_intra_dependency_project_id_project_id_fk',
    }).onDelete('cascade'),
  ],
);

export const analysisLayer = pgTable(
  'analysis_layer',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity({
      name: 'analysis_layer_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    workspaceId: integer('workspace_id').notNull(),
    projectId: integer('project_id').notNull(),
    name: text().notNull(),
    currentVersionNumber: integer('current_version_number').default(1).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('analysis_layer_project_idx').using(
      'btree',
      table.projectId.asc().nullsLast().op('int4_ops'),
    ),
    uniqueIndex('analysis_layer_project_name_idx').using(
      'btree',
      table.projectId.asc().nullsLast().op('int4_ops'),
      table.name.asc().nullsLast().op('int4_ops'),
    ),
    foreignKey({
      columns: [table.workspaceId],
      foreignColumns: [workspace.id],
      name: 'analysis_layer_workspace_id_workspace_id_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.projectId],
      foreignColumns: [project.id],
      name: 'analysis_layer_project_id_project_id_fk',
    }).onDelete('cascade'),
  ],
);

export const analysisDiagramVersion = pgTable(
  'analysis_diagram_version',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity({
      name: 'analysis_diagram_version_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    diagramId: integer('diagram_id').notNull(),
    versionNumber: integer('version_number').notNull(),
    pipelineRunId: text('pipeline_run_id'),
    content: text().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('analysis_diagram_version_diagram_idx').using(
      'btree',
      table.diagramId.asc().nullsLast().op('int4_ops'),
    ),
    index('analysis_diagram_version_run_idx').using(
      'btree',
      table.pipelineRunId.asc().nullsLast().op('text_ops'),
    ),
    uniqueIndex('analysis_diagram_version_unique_idx').using(
      'btree',
      table.diagramId.asc().nullsLast().op('int4_ops'),
      table.versionNumber.asc().nullsLast().op('int4_ops'),
    ),
    foreignKey({
      columns: [table.diagramId],
      foreignColumns: [analysisDiagram.id],
      name: 'analysis_diagram_version_diagram_id_analysis_diagram_id_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.pipelineRunId],
      foreignColumns: [pipelineRun.workflowId],
      name: 'analysis_diagram_version_pipeline_run_id_pipeline_run_workflow_',
    }).onDelete('set null'),
  ],
);

export const analysisEtiquette = pgTable(
  'analysis_etiquette',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity({
      name: 'analysis_etiquette_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    workspaceId: integer('workspace_id').notNull(),
    projectId: integer('project_id').notNull(),
    currentVersionNumber: integer('current_version_number').default(1).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('analysis_etiquette_project_idx').using(
      'btree',
      table.projectId.asc().nullsLast().op('int4_ops'),
    ),
    foreignKey({
      columns: [table.workspaceId],
      foreignColumns: [workspace.id],
      name: 'analysis_etiquette_workspace_id_workspace_id_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.projectId],
      foreignColumns: [project.id],
      name: 'analysis_etiquette_project_id_project_id_fk',
    }).onDelete('cascade'),
  ],
);

export const analysisEtiquetteVersion = pgTable(
  'analysis_etiquette_version',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity({
      name: 'analysis_etiquette_version_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    etiquetteId: integer('etiquette_id').notNull(),
    versionNumber: integer('version_number').notNull(),
    pipelineRunId: text('pipeline_run_id'),
    content: jsonb().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('analysis_etiquette_version_etiquette_idx').using(
      'btree',
      table.etiquetteId.asc().nullsLast().op('int4_ops'),
    ),
    index('analysis_etiquette_version_run_idx').using(
      'btree',
      table.pipelineRunId.asc().nullsLast().op('text_ops'),
    ),
    uniqueIndex('analysis_etiquette_version_unique_idx').using(
      'btree',
      table.etiquetteId.asc().nullsLast().op('int4_ops'),
      table.versionNumber.asc().nullsLast().op('int4_ops'),
    ),
    foreignKey({
      columns: [table.etiquetteId],
      foreignColumns: [analysisEtiquette.id],
      name: 'analysis_etiquette_version_etiquette_id_analysis_etiquette_id_f',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.pipelineRunId],
      foreignColumns: [pipelineRun.workflowId],
      name: 'analysis_etiquette_version_pipeline_run_id_pipeline_run_workflo',
    }).onDelete('set null'),
  ],
);

export const analysisIntraDependencyVersion = pgTable(
  'analysis_intra_dependency_version',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity({
      name: 'analysis_intra_dependency_version_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    intraDependencyId: integer('intra_dependency_id').notNull(),
    versionNumber: integer('version_number').notNull(),
    pipelineRunId: text('pipeline_run_id'),
    content: jsonb().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('analysis_intra_dependency_version_id_idx').using(
      'btree',
      table.intraDependencyId.asc().nullsLast().op('int4_ops'),
    ),
    index('analysis_intra_dependency_version_run_idx').using(
      'btree',
      table.pipelineRunId.asc().nullsLast().op('text_ops'),
    ),
    uniqueIndex('analysis_intra_dependency_version_unique_idx').using(
      'btree',
      table.intraDependencyId.asc().nullsLast().op('int4_ops'),
      table.versionNumber.asc().nullsLast().op('int4_ops'),
    ),
    foreignKey({
      columns: [table.intraDependencyId],
      foreignColumns: [analysisIntraDependency.id],
      name: 'analysis_intra_dependency_version_intra_dependency_id_analysis_',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.pipelineRunId],
      foreignColumns: [pipelineRun.workflowId],
      name: 'analysis_intra_dependency_version_pipeline_run_id_pipeline_run_',
    }).onDelete('set null'),
  ],
);

export const analysisLayerVersion = pgTable(
  'analysis_layer_version',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity({
      name: 'analysis_layer_version_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    layerId: integer('layer_id').notNull(),
    versionNumber: integer('version_number').notNull(),
    pipelineRunId: text('pipeline_run_id'),
    name: text().notNull(),
    purpose: text().notNull(),
    components: jsonb().default([]).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('analysis_layer_version_layer_idx').using(
      'btree',
      table.layerId.asc().nullsLast().op('int4_ops'),
    ),
    index('analysis_layer_version_run_idx').using(
      'btree',
      table.pipelineRunId.asc().nullsLast().op('text_ops'),
    ),
    uniqueIndex('analysis_layer_version_unique_idx').using(
      'btree',
      table.layerId.asc().nullsLast().op('int4_ops'),
      table.versionNumber.asc().nullsLast().op('int4_ops'),
    ),
    foreignKey({
      columns: [table.layerId],
      foreignColumns: [analysisLayer.id],
      name: 'analysis_layer_version_layer_id_analysis_layer_id_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.pipelineRunId],
      foreignColumns: [pipelineRun.workflowId],
      name: 'analysis_layer_version_pipeline_run_id_pipeline_run_workflow_id',
    }).onDelete('set null'),
  ],
);

export const analysisProjectSummary = pgTable(
  'analysis_project_summary',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity({
      name: 'analysis_project_summary_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    workspaceId: integer('workspace_id').notNull(),
    projectId: integer('project_id').notNull(),
    currentVersionNumber: integer('current_version_number').default(1).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('analysis_project_summary_project_idx').using(
      'btree',
      table.projectId.asc().nullsLast().op('int4_ops'),
    ),
    foreignKey({
      columns: [table.workspaceId],
      foreignColumns: [workspace.id],
      name: 'analysis_project_summary_workspace_id_workspace_id_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.projectId],
      foreignColumns: [project.id],
      name: 'analysis_project_summary_project_id_project_id_fk',
    }).onDelete('cascade'),
  ],
);

export const analysisProjectSummaryVersion = pgTable(
  'analysis_project_summary_version',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity({
      name: 'analysis_project_summary_version_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    projectSummaryId: integer('project_summary_id').notNull(),
    versionNumber: integer('version_number').notNull(),
    pipelineRunId: text('pipeline_run_id'),
    content: jsonb().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('analysis_project_summary_version_ps_idx').using(
      'btree',
      table.projectSummaryId.asc().nullsLast().op('int4_ops'),
    ),
    index('analysis_project_summary_version_run_idx').using(
      'btree',
      table.pipelineRunId.asc().nullsLast().op('text_ops'),
    ),
    uniqueIndex('analysis_project_summary_version_unique_idx').using(
      'btree',
      table.projectSummaryId.asc().nullsLast().op('int4_ops'),
      table.versionNumber.asc().nullsLast().op('int4_ops'),
    ),
    foreignKey({
      columns: [table.projectSummaryId],
      foreignColumns: [analysisProjectSummary.id],
      name: 'analysis_project_summary_version_project_summary_id_analysis_pr',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.pipelineRunId],
      foreignColumns: [pipelineRun.workflowId],
      name: 'analysis_project_summary_version_pipeline_run_id_pipeline_run_w',
    }).onDelete('set null'),
  ],
);

export const analysisSetup = pgTable(
  'analysis_setup',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity({
      name: 'analysis_setup_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    workspaceId: integer('workspace_id').notNull(),
    projectId: integer('project_id').notNull(),
    currentVersionNumber: integer('current_version_number').default(1).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('analysis_setup_project_idx').using(
      'btree',
      table.projectId.asc().nullsLast().op('int4_ops'),
    ),
    foreignKey({
      columns: [table.workspaceId],
      foreignColumns: [workspace.id],
      name: 'analysis_setup_workspace_id_workspace_id_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.projectId],
      foreignColumns: [project.id],
      name: 'analysis_setup_project_id_project_id_fk',
    }).onDelete('cascade'),
  ],
);

export const analysisSetupVersion = pgTable(
  'analysis_setup_version',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity({
      name: 'analysis_setup_version_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    setupId: integer('setup_id').notNull(),
    versionNumber: integer('version_number').notNull(),
    pipelineRunId: text('pipeline_run_id'),
    content: jsonb().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('analysis_setup_version_run_idx').using(
      'btree',
      table.pipelineRunId.asc().nullsLast().op('text_ops'),
    ),
    index('analysis_setup_version_setup_idx').using(
      'btree',
      table.setupId.asc().nullsLast().op('int4_ops'),
    ),
    uniqueIndex('analysis_setup_version_unique_idx').using(
      'btree',
      table.setupId.asc().nullsLast().op('int4_ops'),
      table.versionNumber.asc().nullsLast().op('int4_ops'),
    ),
    foreignKey({
      columns: [table.setupId],
      foreignColumns: [analysisSetup.id],
      name: 'analysis_setup_version_setup_id_analysis_setup_id_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.pipelineRunId],
      foreignColumns: [pipelineRun.workflowId],
      name: 'analysis_setup_version_pipeline_run_id_pipeline_run_workflow_id',
    }).onDelete('set null'),
  ],
);

export const analysisUx = pgTable(
  'analysis_ux',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity({
      name: 'analysis_ux_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    workspaceId: integer('workspace_id').notNull(),
    projectId: integer('project_id').notNull(),
    currentVersionNumber: integer('current_version_number').default(1).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('analysis_ux_project_idx').using(
      'btree',
      table.projectId.asc().nullsLast().op('int4_ops'),
    ),
    foreignKey({
      columns: [table.workspaceId],
      foreignColumns: [workspace.id],
      name: 'analysis_ux_workspace_id_workspace_id_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.projectId],
      foreignColumns: [project.id],
      name: 'analysis_ux_project_id_project_id_fk',
    }).onDelete('cascade'),
  ],
);

export const analysisUxVersion = pgTable(
  'analysis_ux_version',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity({
      name: 'analysis_ux_version_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    uxId: integer('ux_id').notNull(),
    versionNumber: integer('version_number').notNull(),
    pipelineRunId: text('pipeline_run_id'),
    content: jsonb().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('analysis_ux_version_run_idx').using(
      'btree',
      table.pipelineRunId.asc().nullsLast().op('text_ops'),
    ),
    uniqueIndex('analysis_ux_version_unique_idx').using(
      'btree',
      table.uxId.asc().nullsLast().op('int4_ops'),
      table.versionNumber.asc().nullsLast().op('int4_ops'),
    ),
    index('analysis_ux_version_ux_idx').using('btree', table.uxId.asc().nullsLast().op('int4_ops')),
    foreignKey({
      columns: [table.uxId],
      foreignColumns: [analysisUx.id],
      name: 'analysis_ux_version_ux_id_analysis_ux_id_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.pipelineRunId],
      foreignColumns: [pipelineRun.workflowId],
      name: 'analysis_ux_version_pipeline_run_id_pipeline_run_workflow_id_fk',
    }).onDelete('set null'),
  ],
);

export const sessionEvent = pgTable(
  'session_event',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity({
      name: 'session_event_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    workspaceId: integer('workspace_id').notNull(),
    projectId: integer('project_id'),
    sessionId: text('session_id').notNull(),
    uuid: text().notNull(),
    parentUuid: text('parent_uuid'),
    eventType: text('event_type').notNull(),
    subtype: sessionEventSubtype().notNull(),
    content: jsonb().notNull(),
    cwd: text(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('session_event_parent_idx').using(
      'btree',
      table.parentUuid.asc().nullsLast().op('text_ops'),
    ),
    index('session_event_project_idx').using(
      'btree',
      table.projectId.asc().nullsLast().op('int4_ops'),
    ),
    index('session_event_session_idx').using(
      'btree',
      table.sessionId.asc().nullsLast().op('text_ops'),
    ),
    index('session_event_subtype_idx').using(
      'btree',
      table.subtype.asc().nullsLast().op('enum_ops'),
    ),
    index('session_event_workspace_idx').using(
      'btree',
      table.workspaceId.asc().nullsLast().op('int4_ops'),
    ),
    foreignKey({
      columns: [table.workspaceId],
      foreignColumns: [workspace.id],
      name: 'session_event_workspace_id_workspace_id_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.projectId],
      foreignColumns: [project.id],
      name: 'session_event_project_id_project_id_fk',
    }).onDelete('set null'),
    unique('session_event_uuid_unique').on(table.uuid),
  ],
);

export const flow = pgTable(
  'flow',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity({
      name: 'flow_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    uuid: text().notNull(),
    workspaceId: integer('workspace_id').notNull(),
    type: flowType().notNull(),
    status: flowStatus().default('active').notNull(),
    startEventUuid: text('start_event_uuid'),
    endEventUuid: text('end_event_uuid'),
    consolidateToUuid: text('consolidate_to_uuid'),
    prdId: integer('prd_id'),
    summary: text(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('flow_prd_idx').using('btree', table.prdId.asc().nullsLast().op('int4_ops')),
    index('flow_status_idx').using('btree', table.status.asc().nullsLast().op('enum_ops')),
    index('flow_type_idx').using('btree', table.type.asc().nullsLast().op('enum_ops')),
    index('flow_workspace_idx').using('btree', table.workspaceId.asc().nullsLast().op('int4_ops')),
    foreignKey({
      columns: [table.workspaceId],
      foreignColumns: [workspace.id],
      name: 'flow_workspace_id_workspace_id_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.prdId],
      foreignColumns: [prd.id],
      name: 'flow_prd_id_prd_id_fk',
    }).onDelete('set null'),
    unique('flow_uuid_unique').on(table.uuid),
  ],
);

export const prd = pgTable(
  'prd',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity({
      name: 'prd_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    uuid: text().notNull(),
    workspaceId: integer('workspace_id').notNull(),
    projectId: integer('project_id'),
    // You can use { mode: "bigint" } if numbers are exceeding js number limitations
    repositoryId: bigint('repository_id', { mode: 'number' }),
    goalId: integer('goal_id'),
    title: text().notNull(),
    summary: text(),
    ux: text(),
    goals: jsonb().default([]),
    affectedFnc: jsonb('affected_fnc').default([]),
    assumptions: jsonb().default([]),
    notes: jsonb().default([]),
    status: documentStatus().default('draft').notNull(),
    approved: boolean().default(false),
    versionNumber: integer('version_number').default(1).notNull(),
    revisedFromPrdId: integer('revised_from_prd_id'),
    originatingPrompt: text('originating_prompt'),
    originatingSessionId: text('originating_session_id'),
    artifactId: integer('artifact_id'),
    createdByUserId: integer('created_by_user_id'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('prd_artifact_idx').using('btree', table.artifactId.asc().nullsLast().op('int4_ops')),
    index('prd_created_by_idx').using(
      'btree',
      table.createdByUserId.asc().nullsLast().op('int4_ops'),
    ),
    index('prd_goal_idx').using('btree', table.goalId.asc().nullsLast().op('int4_ops')),
    index('prd_project_idx').using('btree', table.projectId.asc().nullsLast().op('int4_ops')),
    index('prd_repository_idx').using('btree', table.repositoryId.asc().nullsLast().op('int8_ops')),
    index('prd_revised_from_idx').using(
      'btree',
      table.revisedFromPrdId.asc().nullsLast().op('int4_ops'),
    ),
    index('prd_status_idx').using('btree', table.status.asc().nullsLast().op('enum_ops')),
    index('prd_workspace_idx').using('btree', table.workspaceId.asc().nullsLast().op('int4_ops')),
    foreignKey({
      columns: [table.workspaceId],
      foreignColumns: [workspace.id],
      name: 'prd_workspace_id_workspace_id_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.projectId],
      foreignColumns: [project.id],
      name: 'prd_project_id_project_id_fk',
    }).onDelete('set null'),
    foreignKey({
      columns: [table.repositoryId],
      foreignColumns: [repository.id],
      name: 'prd_repository_id_repository_id_fk',
    }).onDelete('set null'),
    foreignKey({
      columns: [table.goalId],
      foreignColumns: [goal.id],
      name: 'prd_goal_id_goal_id_fk',
    }).onDelete('set null'),
    foreignKey({
      columns: [table.revisedFromPrdId],
      foreignColumns: [table.id],
      name: 'prd_revised_from_prd_id_prd_id_fk',
    }).onDelete('set null'),
    foreignKey({
      columns: [table.artifactId],
      foreignColumns: [analysisContextArtifact.id],
      name: 'prd_artifact_id_analysis_context_artifact_id_fk',
    }).onDelete('set null'),
    foreignKey({
      columns: [table.createdByUserId],
      foreignColumns: [user.id],
      name: 'prd_created_by_user_id_user_id_fk',
    }).onDelete('set null'),
    unique('prd_uuid_unique').on(table.uuid),
  ],
);

export const technicalSpec = pgTable(
  'technical_spec',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity({
      name: 'technical_spec_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    uuid: text().notNull(),
    workspaceId: integer('workspace_id').notNull(),
    projectId: integer('project_id'),
    // You can use { mode: "bigint" } if numbers are exceeding js number limitations
    repositoryId: bigint('repository_id', { mode: 'number' }),
    prdId: integer('prd_id'),
    title: text().notNull(),
    summary: text(),
    diagram: text(),
    architectureChanges: jsonb('architecture_changes'),
    typeChanges: jsonb('type_changes').default([]),
    fileChanges: jsonb('file_changes').default([]),
    apiChanges: jsonb('api_changes').default([]),
    implementationSteps: jsonb('implementation_steps').default([]),
    extraText: text('extra_text'),
    notes: jsonb().default([]),
    status: documentStatus().default('draft').notNull(),
    approved: boolean().default(false),
    versionNumber: integer('version_number').default(1).notNull(),
    revisedFromTechnicalSpecId: integer('revised_from_technical_spec_id'),
    originatingPrompt: text('originating_prompt'),
    originatingSessionId: text('originating_session_id'),
    artifactId: integer('artifact_id'),
    createdByUserId: integer('created_by_user_id'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('technical_spec_artifact_idx').using(
      'btree',
      table.artifactId.asc().nullsLast().op('int4_ops'),
    ),
    index('technical_spec_created_by_idx').using(
      'btree',
      table.createdByUserId.asc().nullsLast().op('int4_ops'),
    ),
    index('technical_spec_prd_idx').using('btree', table.prdId.asc().nullsLast().op('int4_ops')),
    index('technical_spec_project_idx').using(
      'btree',
      table.projectId.asc().nullsLast().op('int4_ops'),
    ),
    index('technical_spec_repository_idx').using(
      'btree',
      table.repositoryId.asc().nullsLast().op('int8_ops'),
    ),
    index('technical_spec_revised_from_idx').using(
      'btree',
      table.revisedFromTechnicalSpecId.asc().nullsLast().op('int4_ops'),
    ),
    index('technical_spec_status_idx').using(
      'btree',
      table.status.asc().nullsLast().op('enum_ops'),
    ),
    index('technical_spec_workspace_idx').using(
      'btree',
      table.workspaceId.asc().nullsLast().op('int4_ops'),
    ),
    foreignKey({
      columns: [table.workspaceId],
      foreignColumns: [workspace.id],
      name: 'technical_spec_workspace_id_workspace_id_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.projectId],
      foreignColumns: [project.id],
      name: 'technical_spec_project_id_project_id_fk',
    }).onDelete('set null'),
    foreignKey({
      columns: [table.repositoryId],
      foreignColumns: [repository.id],
      name: 'technical_spec_repository_id_repository_id_fk',
    }).onDelete('set null'),
    foreignKey({
      columns: [table.prdId],
      foreignColumns: [prd.id],
      name: 'technical_spec_prd_id_prd_id_fk',
    }).onDelete('set null'),
    foreignKey({
      columns: [table.artifactId],
      foreignColumns: [analysisContextArtifact.id],
      name: 'technical_spec_artifact_id_analysis_context_artifact_id_fk',
    }).onDelete('set null'),
    foreignKey({
      columns: [table.createdByUserId],
      foreignColumns: [user.id],
      name: 'technical_spec_created_by_user_id_user_id_fk',
    }).onDelete('set null'),
    foreignKey({
      columns: [table.revisedFromTechnicalSpecId],
      foreignColumns: [table.id],
      name: 'technical_spec_revised_from_technical_spec_id_technical_spec_id',
    }).onDelete('set null'),
    unique('technical_spec_uuid_unique').on(table.uuid),
  ],
);

export const task = pgTable(
  'task',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity({
      name: 'task_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    uuid: text().notNull(),
    workspaceId: integer('workspace_id').notNull(),
    technicalSpecId: integer('technical_spec_id').notNull(),
    title: text().notNull(),
    steps: jsonb().default([]),
    status: taskStatus().default('pending').notNull(),
    createdByUserId: integer('created_by_user_id'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('task_created_by_idx').using(
      'btree',
      table.createdByUserId.asc().nullsLast().op('int4_ops'),
    ),
    index('task_status_idx').using('btree', table.status.asc().nullsLast().op('enum_ops')),
    index('task_technical_spec_idx').using(
      'btree',
      table.technicalSpecId.asc().nullsLast().op('int4_ops'),
    ),
    index('task_workspace_idx').using('btree', table.workspaceId.asc().nullsLast().op('int4_ops')),
    foreignKey({
      columns: [table.workspaceId],
      foreignColumns: [workspace.id],
      name: 'task_workspace_id_workspace_id_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.technicalSpecId],
      foreignColumns: [technicalSpec.id],
      name: 'task_technical_spec_id_technical_spec_id_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.createdByUserId],
      foreignColumns: [user.id],
      name: 'task_created_by_user_id_user_id_fk',
    }).onDelete('set null'),
    unique('task_uuid_unique').on(table.uuid),
  ],
);

export const plan = pgTable(
  'plan',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity({
      name: 'plan_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    workflowId: text('workflow_id').notNull(),
    goalId: integer('goal_id').notNull(),
    projectId: integer('project_id').notNull(),
    result: text(),
    status: workflowExecutionStatus().default('pending').notNull(),
    error: text(),
    startedAt: timestamp('started_at', { withTimezone: true, mode: 'string' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true, mode: 'string' }),
    temporalRunId: text('temporal_run_id'),
  },
  (table) => [
    index('plan_goal_id_idx').using('btree', table.goalId.asc().nullsLast().op('int4_ops')),
    index('plan_project_id_idx').using('btree', table.projectId.asc().nullsLast().op('int4_ops')),
    index('plan_status_idx').using('btree', table.status.asc().nullsLast().op('enum_ops')),
    uniqueIndex('plan_workflow_id_idx').using(
      'btree',
      table.workflowId.asc().nullsLast().op('text_ops'),
    ),
    foreignKey({
      columns: [table.goalId],
      foreignColumns: [goal.id],
      name: 'plan_goal_id_goal_id_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.projectId],
      foreignColumns: [project.id],
      name: 'plan_project_id_project_id_fk',
    }).onDelete('cascade'),
  ],
);

export const projectAnalysis = pgTable(
  'project_analysis',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity({
      name: 'project_analysis_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    workflowId: text('workflow_id').notNull(),
    projectId: integer('project_id').notNull(),
    result: text(),
    status: workflowExecutionStatus().default('pending').notNull(),
    error: text(),
    startedAt: timestamp('started_at', { withTimezone: true, mode: 'string' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true, mode: 'string' }),
    temporalRunId: text('temporal_run_id'),
  },
  (table) => [
    index('project_analysis_project_id_idx').using(
      'btree',
      table.projectId.asc().nullsLast().op('int4_ops'),
    ),
    index('project_analysis_status_idx').using(
      'btree',
      table.status.asc().nullsLast().op('enum_ops'),
    ),
    uniqueIndex('project_analysis_workflow_id_idx').using(
      'btree',
      table.workflowId.asc().nullsLast().op('text_ops'),
    ),
    foreignKey({
      columns: [table.projectId],
      foreignColumns: [project.id],
      name: 'project_analysis_project_id_project_id_fk',
    }).onDelete('cascade'),
  ],
);

export const sandboxLifecycleEvent = pgTable(
  'sandbox_lifecycle_event',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity({
      name: 'sandbox_lifecycle_event_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    deliveryId: text('delivery_id').notNull(),
    sandboxId: text('sandbox_id').notNull(),
    executionId: text('execution_id'),
    templateId: text('template_id'),
    buildId: text('build_id'),
    eventType: text('event_type').notNull(),
    eventTimestamp: timestamp('event_timestamp', { withTimezone: true, mode: 'string' }).notNull(),
    workspaceId: integer('workspace_id').notNull(),
    projectId: integer('project_id').notNull(),
    // You can use { mode: "bigint" } if numbers are exceeding js number limitations
    repositoryId: bigint('repository_id', { mode: 'number' }),
    goalId: integer('goal_id'),
    userId: integer('user_id'),
    payload: jsonb().notNull(),
    processedAt: timestamp('processed_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
    workflowId: text('workflow_id').notNull(),
    taskQueue: text('task_queue').notNull(),
    workflowType: text('workflow_type'),
  },
  (table) => [
    uniqueIndex('sandbox_lifecycle_event_delivery_unique').using(
      'btree',
      table.deliveryId.asc().nullsLast().op('text_ops'),
    ),
    index('sandbox_lifecycle_event_sandbox_id_idx').using(
      'btree',
      table.sandboxId.asc().nullsLast().op('text_ops'),
      table.eventTimestamp.asc().nullsLast().op('timestamptz_ops'),
    ),
    index('sandbox_lifecycle_event_workflow_id_idx').using(
      'btree',
      table.workflowId.asc().nullsLast().op('text_ops'),
    ),
    index('sandbox_lifecycle_event_workspace_processed_idx').using(
      'btree',
      table.workspaceId.asc().nullsLast().op('timestamptz_ops'),
      table.processedAt.asc().nullsLast().op('timestamptz_ops'),
    ),
    foreignKey({
      columns: [table.workspaceId],
      foreignColumns: [workspace.id],
      name: 'sandbox_lifecycle_event_workspace_id_workspace_id_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.projectId],
      foreignColumns: [project.id],
      name: 'sandbox_lifecycle_event_project_id_project_id_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.goalId],
      foreignColumns: [goal.id],
      name: 'sandbox_lifecycle_event_goal_id_goal_id_fk',
    }).onDelete('set null'),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [user.id],
      name: 'sandbox_lifecycle_event_user_id_user_id_fk',
    }).onDelete('set null'),
    foreignKey({
      columns: [table.repositoryId],
      foreignColumns: [repository.id],
      name: 'sandbox_lifecycle_event_repository_id_repository_id_fk',
    }).onDelete('set null'),
  ],
);

export const sandboxLifecycleSnapshot = pgTable(
  'sandbox_lifecycle_snapshot',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity({
      name: 'sandbox_lifecycle_snapshot_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    sandboxId: text('sandbox_id').notNull(),
    executionId: text('execution_id'),
    templateId: text('template_id'),
    buildId: text('build_id'),
    workspaceId: integer('workspace_id').notNull(),
    projectId: integer('project_id').notNull(),
    // You can use { mode: "bigint" } if numbers are exceeding js number limitations
    repositoryId: bigint('repository_id', { mode: 'number' }),
    goalId: integer('goal_id'),
    userId: integer('user_id'),
    totalEvents: integer('total_events').default(0).notNull(),
    createdCount: integer('created_count').default(0).notNull(),
    updatedCount: integer('updated_count').default(0).notNull(),
    pausedCount: integer('paused_count').default(0).notNull(),
    resumedCount: integer('resumed_count').default(0).notNull(),
    killedCount: integer('killed_count').default(0).notNull(),
    firstEventAt: timestamp('first_event_at', { withTimezone: true, mode: 'string' }).notNull(),
    lastEventAt: timestamp('last_event_at', { withTimezone: true, mode: 'string' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
    workflowId: text('workflow_id').notNull(),
    taskQueue: text('task_queue').notNull(),
    workflowType: text('workflow_type'),
  },
  (table) => [
    uniqueIndex('sandbox_lifecycle_snapshot_sandbox_id_unique').using(
      'btree',
      table.sandboxId.asc().nullsLast().op('text_ops'),
    ),
    index('sandbox_lifecycle_snapshot_workflow_id_idx').using(
      'btree',
      table.workflowId.asc().nullsLast().op('text_ops'),
    ),
    index('sandbox_lifecycle_snapshot_workspace_last_event_idx').using(
      'btree',
      table.workspaceId.asc().nullsLast().op('int4_ops'),
      table.lastEventAt.asc().nullsLast().op('int4_ops'),
    ),
    foreignKey({
      columns: [table.workspaceId],
      foreignColumns: [workspace.id],
      name: 'sandbox_lifecycle_snapshot_workspace_id_workspace_id_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.projectId],
      foreignColumns: [project.id],
      name: 'sandbox_lifecycle_snapshot_project_id_project_id_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.goalId],
      foreignColumns: [goal.id],
      name: 'sandbox_lifecycle_snapshot_goal_id_goal_id_fk',
    }).onDelete('set null'),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [user.id],
      name: 'sandbox_lifecycle_snapshot_user_id_user_id_fk',
    }).onDelete('set null'),
    foreignKey({
      columns: [table.repositoryId],
      foreignColumns: [repository.id],
      name: 'sandbox_lifecycle_snapshot_repository_id_repository_id_fk',
    }).onDelete('set null'),
  ],
);

export const sandboxWorkflowMapping = pgTable(
  'sandbox_workflow_mapping',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity({
      name: 'sandbox_workflow_mapping_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    sandboxId: text('sandbox_id').notNull(),
    workflowId: text('workflow_id').notNull(),
    taskQueue: text('task_queue').notNull(),
    workflowType: text('workflow_type').notNull(),
    runStatus: sandboxRunStatus('run_status').default('active').notNull(),
    runId: text('run_id'),
    phaseId: text('phase_id'),
    phaseVersion: integer('phase_version'),
    interactionId: text('interaction_id'),
    workspaceId: integer('workspace_id').notNull(),
    projectId: integer('project_id').notNull(),
    // You can use { mode: "bigint" } if numbers are exceeding js number limitations
    repositoryId: bigint('repository_id', { mode: 'number' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
    closedAt: timestamp('closed_at', { withTimezone: true, mode: 'string' }),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('sandbox_workflow_mapping_project_idx').using(
      'btree',
      table.projectId.asc().nullsLast().op('int4_ops'),
    ),
    index('sandbox_workflow_mapping_repository_idx').using(
      'btree',
      table.repositoryId.asc().nullsLast().op('int8_ops'),
    ),
    uniqueIndex('sandbox_workflow_mapping_sandbox_id_unique').using(
      'btree',
      table.sandboxId.asc().nullsLast().op('text_ops'),
    ),
    index('sandbox_workflow_mapping_workflow_phase_idx').using(
      'btree',
      table.workflowId.asc().nullsLast().op('text_ops'),
      table.phaseId.asc().nullsLast().op('text_ops'),
    ),
    index('sandbox_workflow_mapping_workspace_idx').using(
      'btree',
      table.workspaceId.asc().nullsLast().op('int4_ops'),
    ),
    foreignKey({
      columns: [table.workspaceId],
      foreignColumns: [workspace.id],
      name: 'sandbox_workflow_mapping_workspace_id_workspace_id_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.projectId],
      foreignColumns: [project.id],
      name: 'sandbox_workflow_mapping_project_id_project_id_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.repositoryId],
      foreignColumns: [repository.id],
      name: 'sandbox_workflow_mapping_repository_id_repository_id_fk',
    }).onDelete('set null'),
  ],
);

export const pullRequestActionItemSource = pgTable(
  'pull_request_action_item_source',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity({
      name: 'pull_request_action_item_source_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    actionItemId: integer('action_item_id').notNull(),
    sourceType: actionItemSourceType('source_type').notNull(),
    sourceIdentifier: text('source_identifier').notNull(),
    sourceUrl: text('source_url'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('pull_request_action_item_source_dedup_idx').using(
      'btree',
      table.actionItemId.asc().nullsLast().op('int4_ops'),
      table.sourceType.asc().nullsLast().op('enum_ops'),
      table.sourceIdentifier.asc().nullsLast().op('enum_ops'),
    ),
    foreignKey({
      columns: [table.actionItemId],
      foreignColumns: [pullRequestActionItem.id],
      name: 'pull_request_action_item_source_action_item_id_pull_request_act',
    }).onDelete('cascade'),
  ],
);

export const repositorySandboxSession = pgTable(
  'repository_sandbox_session',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity({
      name: 'repository_sandbox_session_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    sandboxId: text('sandbox_id').notNull(),
    workspaceId: integer('workspace_id').notNull(),
    projectId: integer('project_id').notNull(),
    // You can use { mode: "bigint" } if numbers are exceeding js number limitations
    repositoryId: bigint('repository_id', { mode: 'number' }),
    userId: integer('user_id').notNull(),
    status: repositorySandboxSessionStatus().default('active').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('repository_sandbox_session_project_idx').using(
      'btree',
      table.projectId.asc().nullsLast().op('int4_ops'),
    ),
    index('repository_sandbox_session_repository_created_idx').using(
      'btree',
      table.repositoryId.asc().nullsLast().op('int8_ops'),
      table.createdAt.asc().nullsLast().op('int8_ops'),
    ),
    uniqueIndex('repository_sandbox_session_sandbox_id_unique').using(
      'btree',
      table.sandboxId.asc().nullsLast().op('text_ops'),
    ),
    index('repository_sandbox_session_user_idx').using(
      'btree',
      table.userId.asc().nullsLast().op('int4_ops'),
    ),
    index('repository_sandbox_session_workspace_idx').using(
      'btree',
      table.workspaceId.asc().nullsLast().op('int4_ops'),
    ),
    foreignKey({
      columns: [table.workspaceId],
      foreignColumns: [workspace.id],
      name: 'repository_sandbox_session_workspace_id_workspace_id_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.projectId],
      foreignColumns: [project.id],
      name: 'repository_sandbox_session_project_id_project_id_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.repositoryId],
      foreignColumns: [repository.id],
      name: 'repository_sandbox_session_repository_id_repository_id_fk',
    }).onDelete('set null'),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [user.id],
      name: 'repository_sandbox_session_user_id_user_id_fk',
    }).onDelete('cascade'),
  ],
);

export const repositorySandboxTerminalEvent = pgTable(
  'repository_sandbox_terminal_event',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity({
      name: 'repository_sandbox_terminal_event_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    sessionId: integer('session_id').notNull(),
    commandId: text('command_id').notNull(),
    sequenceNumber: integer('sequence_number').notNull(),
    eventType: text('event_type').notNull(),
    content: text().notNull(),
    exitCode: integer('exit_code'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('repository_sandbox_terminal_event_session_command_idx').using(
      'btree',
      table.sessionId.asc().nullsLast().op('int4_ops'),
      table.commandId.asc().nullsLast().op('int4_ops'),
    ),
    index('repository_sandbox_terminal_event_session_created_idx').using(
      'btree',
      table.sessionId.asc().nullsLast().op('int4_ops'),
      table.createdAt.asc().nullsLast().op('timestamptz_ops'),
    ),
    uniqueIndex('repository_sandbox_terminal_event_session_seq_unique').using(
      'btree',
      table.sessionId.asc().nullsLast().op('int4_ops'),
      table.sequenceNumber.asc().nullsLast().op('int4_ops'),
    ),
    foreignKey({
      columns: [table.sessionId],
      foreignColumns: [repositorySandboxSession.id],
      name: 'repository_sandbox_terminal_event_session_id_repository_sandbox',
    }).onDelete('cascade'),
  ],
);

export const pullRequestActionItem = pgTable(
  'pull_request_action_item',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity({
      name: 'pull_request_action_item_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    pullRequestStateId: integer('pull_request_state_id').notNull(),
    stableKey: text('stable_key').notNull(),
    subject: text().notNull(),
    description: text(),
    status: actionItemStatus().default('pending').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
    firstSeenHeadSha: text('first_seen_head_sha'),
  },
  (table) => [
    uniqueIndex('pull_request_action_item_state_key_idx').using(
      'btree',
      table.pullRequestStateId.asc().nullsLast().op('int4_ops'),
      table.stableKey.asc().nullsLast().op('int4_ops'),
    ),
    index('pull_request_action_item_status_idx').using(
      'btree',
      table.status.asc().nullsLast().op('enum_ops'),
    ),
    foreignKey({
      columns: [table.pullRequestStateId],
      foreignColumns: [pullRequestState.id],
      name: 'pull_request_action_item_pull_request_state_id_pull_request_sta',
    }).onDelete('cascade'),
  ],
);

export const workspaceInviteLink = pgTable(
  'workspace_invite_link',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity({
      name: 'workspace_invite_link_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    workspaceId: integer('workspace_id').notNull(),
    createdByUserId: integer('created_by_user_id').notNull(),
    role: workspaceRole().notNull(),
    tokenHash: text('token_hash').notNull(),
    label: text(),
    maxUses: integer('max_uses'),
    useCount: integer('use_count').default(0).notNull(),
    passwordHash: text('password_hash'),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'string' }),
    isActive: boolean('is_active').default(true).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('workspace_invite_link_active_workspace_idx')
      .using(
        'btree',
        table.workspaceId.asc().nullsLast().op('int4_ops'),
        table.isActive.asc().nullsLast().op('bool_ops'),
      )
      .where(sql`(is_active = true)`),
    index('workspace_invite_link_created_by_idx').using(
      'btree',
      table.createdByUserId.asc().nullsLast().op('int4_ops'),
    ),
    index('workspace_invite_link_workspace_idx').using(
      'btree',
      table.workspaceId.asc().nullsLast().op('int4_ops'),
    ),
    foreignKey({
      columns: [table.workspaceId],
      foreignColumns: [workspace.id],
      name: 'workspace_invite_link_workspace_id_workspace_id_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.createdByUserId],
      foreignColumns: [user.id],
      name: 'workspace_invite_link_created_by_user_id_user_id_fk',
    }).onDelete('cascade'),
    unique('workspace_invite_link_token_hash_key').on(table.tokenHash),
    check('workspace_invite_link_max_uses_range', sql`(max_uses > 0) AND (max_uses <= 10000)`),
  ],
);

export const workspaceInviteLinkUse = pgTable(
  'workspace_invite_link_use',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity({
      name: 'workspace_invite_link_use_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    inviteLinkId: integer('invite_link_id').notNull(),
    userId: integer('user_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('workspace_invite_link_use_invite_link_idx').using(
      'btree',
      table.inviteLinkId.asc().nullsLast().op('int4_ops'),
    ),
    uniqueIndex('workspace_invite_link_use_unique_idx').using(
      'btree',
      table.inviteLinkId.asc().nullsLast().op('int4_ops'),
      table.userId.asc().nullsLast().op('int4_ops'),
    ),
    index('workspace_invite_link_use_user_idx').using(
      'btree',
      table.userId.asc().nullsLast().op('int4_ops'),
    ),
    foreignKey({
      columns: [table.inviteLinkId],
      foreignColumns: [workspaceInviteLink.id],
      name: 'workspace_invite_link_use_invite_link_id_workspace_invite_link_',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [user.id],
      name: 'workspace_invite_link_use_user_id_user_id_fk',
    }).onDelete('cascade'),
  ],
);

export const template = pgTable(
  'template',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    workspaceId: integer('workspace_id').notNull(),
    title: text().notNull(),
    description: text().notNull(),
    markdown: text().notNull(),
    snapshot: text().notNull(),
    frontmatter: text().notNull(),
    template: text().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('template_workspace_idx').using(
      'btree',
      table.workspaceId.asc().nullsLast().op('int4_ops'),
    ),
    foreignKey({
      columns: [table.workspaceId],
      foreignColumns: [workspace.id],
      name: 'template_workspace_id_workspace_id_fk',
    }).onDelete('cascade'),
  ],
);

export const goalLayer = pgTable(
  'goal_layer',
  {
    goalId: integer('goal_id').notNull(),
    layerId: integer('layer_id').notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.goalId],
      foreignColumns: [goal.id],
      name: 'goal_layer_goal_id_goal_id_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.layerId],
      foreignColumns: [analysisLayer.id],
      name: 'goal_layer_layer_id_analysis_layer_id_fk',
    }).onDelete('cascade'),
    primaryKey({ columns: [table.goalId, table.layerId], name: 'goal_layer_goal_id_layer_id_pk' }),
  ],
);

export const goalCapability = pgTable(
  'goal_capability',
  {
    goalId: integer('goal_id').notNull(),
    capabilityId: integer('capability_id').notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.goalId],
      foreignColumns: [goal.id],
      name: 'goal_capability_goal_id_goal_id_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.capabilityId],
      foreignColumns: [analysisCapability.id],
      name: 'goal_capability_capability_id_analysis_capability_id_fk',
    }).onDelete('cascade'),
    primaryKey({
      columns: [table.goalId, table.capabilityId],
      name: 'goal_capability_goal_id_capability_id_pk',
    }),
  ],
);

export const goalConnection = pgTable(
  'goal_connection',
  {
    goalId: integer('goal_id').notNull(),
    connectedGoalId: integer('connected_goal_id').notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.goalId],
      foreignColumns: [goal.id],
      name: 'goal_connection_goal_id_goal_id_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.connectedGoalId],
      foreignColumns: [goal.id],
      name: 'goal_connection_connected_goal_id_goal_id_fk',
    }).onDelete('cascade'),
    primaryKey({
      columns: [table.goalId, table.connectedGoalId],
      name: 'goal_connection_goal_id_connected_goal_id_pk',
    }),
  ],
);

export const goalFeature = pgTable(
  'goal_feature',
  {
    goalId: integer('goal_id').notNull(),
    featureId: integer('feature_id').notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.goalId],
      foreignColumns: [goal.id],
      name: 'goal_feature_goal_id_goal_id_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.featureId],
      foreignColumns: [analysisFeature.id],
      name: 'goal_feature_feature_id_analysis_feature_id_fk',
    }).onDelete('cascade'),
    primaryKey({
      columns: [table.goalId, table.featureId],
      name: 'goal_feature_goal_id_feature_id_pk',
    }),
  ],
);

export const taskDependency = pgTable(
  'task_dependency',
  {
    taskId: integer('task_id').notNull(),
    dependsOnTaskId: integer('depends_on_task_id').notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.taskId],
      foreignColumns: [task.id],
      name: 'task_dependency_task_id_task_id_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.dependsOnTaskId],
      foreignColumns: [task.id],
      name: 'task_dependency_depends_on_task_id_task_id_fk',
    }).onDelete('cascade'),
    primaryKey({
      columns: [table.taskId, table.dependsOnTaskId],
      name: 'task_dependency_task_id_depends_on_task_id_pk',
    }),
  ],
);

export const pullRequestActionItemDependency = pgTable(
  'pull_request_action_item_dependency',
  {
    actionItemId: integer('action_item_id').notNull(),
    dependsOnActionItemId: integer('depends_on_action_item_id').notNull(),
  },
  (table) => [
    index('pull_request_action_item_dependency_reverse_idx').using(
      'btree',
      table.dependsOnActionItemId.asc().nullsLast().op('int4_ops'),
    ),
    foreignKey({
      columns: [table.actionItemId],
      foreignColumns: [pullRequestActionItem.id],
      name: 'pull_request_action_item_dependency_action_item_id_pull_request',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.dependsOnActionItemId],
      foreignColumns: [pullRequestActionItem.id],
      name: 'pull_request_action_item_dependency_depends_on_action_item_id_p',
    }).onDelete('cascade'),
    primaryKey({
      columns: [table.actionItemId, table.dependsOnActionItemId],
      name: 'pull_request_action_item_dependency_action_item_id_depends_on_a',
    }),
    check(
      'pull_request_action_item_dependency_no_self_ref',
      sql`action_item_id <> depends_on_action_item_id`,
    ),
  ],
);

export const projectRepository = pgTable(
  'project_repository',
  {
    projectId: integer('project_id').notNull(),
    // You can use { mode: "bigint" } if numbers are exceeding js number limitations
    repositoryId: bigint('repository_id', { mode: 'number' }).notNull(),
    createdAt: timestamp('created_at', { mode: 'string' }).defaultNow().notNull(),
  },
  (table) => [
    index('project_repository_repository_idx').using(
      'btree',
      table.repositoryId.asc().nullsLast().op('int8_ops'),
    ),
    foreignKey({
      columns: [table.projectId],
      foreignColumns: [project.id],
      name: 'project_repository_project_id_project_id_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.repositoryId],
      foreignColumns: [repository.id],
      name: 'project_repository_repository_id_repository_id_fk',
    }).onDelete('restrict'),
    primaryKey({
      columns: [table.projectId, table.repositoryId],
      name: 'project_repository_project_id_repository_id_pk',
    }),
  ],
);

export const linearIssueLabel = pgTable(
  'linear_issue_label',
  {
    issueId: integer('issue_id').notNull(),
    labelId: integer('label_id').notNull(),
    createdAt: timestamp('created_at', { mode: 'string' }).defaultNow().notNull(),
  },
  (table) => [
    index('linear_issue_label_label_idx').using(
      'btree',
      table.labelId.asc().nullsLast().op('int4_ops'),
    ),
    foreignKey({
      columns: [table.issueId],
      foreignColumns: [linearIssue.id],
      name: 'linear_issue_label_issue_id_linear_issue_id_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.labelId],
      foreignColumns: [linearLabel.id],
      name: 'linear_issue_label_label_id_linear_label_id_fk',
    }).onDelete('cascade'),
    primaryKey({
      columns: [table.issueId, table.labelId],
      name: 'linear_issue_label_issue_id_label_id_pk',
    }),
  ],
);

export const analysisRunRepository = pgTable(
  'analysis_run_repository',
  {
    workflowId: text('workflow_id').notNull(),
    // You can use { mode: "bigint" } if numbers are exceeding js number limitations
    repositoryId: bigint('repository_id', { mode: 'number' }).notNull(),
    uri: text().notNull(),
    // You can use { mode: "bigint" } if numbers are exceeding js number limitations
    installationId: bigint('installation_id', { mode: 'number' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('analysis_run_repository_workflow_id_idx').using(
      'btree',
      table.workflowId.asc().nullsLast().op('text_ops'),
    ),
    foreignKey({
      columns: [table.workflowId],
      foreignColumns: [analysisContext.workflowId],
      name: 'analysis_run_repository_workflow_id_analysis_context_workflow_i',
    }).onDelete('cascade'),
    primaryKey({
      columns: [table.workflowId, table.repositoryId],
      name: 'analysis_run_repository_workflow_id_repository_id_pk',
    }),
  ],
);

export const projectReviewAgent = pgTable(
  'project_review_agent',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity({
      name: 'project_review_agent_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    projectId: integer('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    description: text(),
    policy: reviewAgentPolicy().default('all_prs').notNull(),
    scope: reviewAgentScope().default('all_repositories').notNull(),
    requiredLabels: text('required_labels'),
    instructions: text().notNull(),
    enabled: boolean().default(true).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('project_review_agent_project_idx').using(
      'btree',
      table.projectId.asc().nullsLast().op('int4_ops'),
    ),
    index('project_review_agent_enabled_idx').using(
      'btree',
      table.projectId.asc().nullsLast().op('int4_ops'),
      table.enabled.asc().nullsLast().op('bool_ops'),
    ),
  ],
);

export const projectReviewAgentPattern = pgTable(
  'project_review_agent_pattern',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity({
      name: 'project_review_agent_pattern_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    agentId: integer('agent_id')
      .notNull()
      .references(() => projectReviewAgent.id, { onDelete: 'cascade' }),
    pattern: text().notNull(),
    orderIndex: integer('order_index').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('project_review_agent_pattern_agent_order_idx').using(
      'btree',
      table.agentId.asc().nullsLast().op('int4_ops'),
      table.orderIndex.asc().nullsLast().op('int4_ops'),
    ),
  ],
);

export const projectReviewAgentRepository = pgTable(
  'project_review_agent_repository',
  {
    agentId: integer('agent_id')
      .notNull()
      .references(() => projectReviewAgent.id, { onDelete: 'cascade' }),
    repositoryId: bigint('repository_id', { mode: 'number' })
      .notNull()
      .references(() => repository.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.agentId, table.repositoryId],
      name: 'project_review_agent_repository_agent_id_repository_id_pk',
    }),
    index('project_review_agent_repository_repository_idx').using(
      'btree',
      table.repositoryId.asc().nullsLast().op('int8_ops'),
    ),
  ],
);

export const projectReviewAgentRun = pgTable(
  'project_review_agent_run',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity({
      name: 'project_review_agent_run_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    agentId: integer('agent_id')
      .notNull()
      .references(() => projectReviewAgent.id, { onDelete: 'cascade' }),
    repositoryId: bigint('repository_id', { mode: 'number' })
      .notNull()
      .references(() => repository.id, { onDelete: 'cascade' }),
    prNumber: integer('pr_number').notNull(),
    headSha: text('head_sha').notNull(),
    status: reviewAgentRunStatus().default('pending').notNull(),
    errorMessage: text('error_message'),
    workflowRunId: text('workflow_run_id'),
    startedAt: timestamp('started_at', { withTimezone: true, mode: 'string' }),
    completedAt: timestamp('completed_at', { withTimezone: true, mode: 'string' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('project_review_agent_run_dedupe_idx').using(
      'btree',
      table.agentId.asc().nullsLast().op('int4_ops'),
      table.repositoryId.asc().nullsLast().op('int8_ops'),
      table.prNumber.asc().nullsLast().op('int4_ops'),
      table.headSha.asc().nullsLast().op('text_ops'),
    ),
    index('project_review_agent_run_agent_idx').using(
      'btree',
      table.agentId.asc().nullsLast().op('int4_ops'),
    ),
    index('project_review_agent_run_repo_pr_idx').using(
      'btree',
      table.repositoryId.asc().nullsLast().op('int8_ops'),
      table.prNumber.asc().nullsLast().op('int4_ops'),
    ),
    index('project_review_agent_run_status_idx').using('btree', table.status.asc().nullsLast()),
  ],
);
