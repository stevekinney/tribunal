import { pgEnum } from 'drizzle-orm/pg-core';

// ============================================================================
// AUTHORIZATION ENUMS
// ============================================================================

/** Historical login-provider enum retained for existing database type continuity. */
export const authProviderEnum = pgEnum('auth_provider', ['github']);

/** Supported OAuth providers for oauth_connection (API access tokens) */
export const oauthProviderEnum = pgEnum('oauth_provider', ['github']);

/** Health status of a stored OAuth connection */
export const oauthConnectionStatusEnum = pgEnum('oauth_connection_status', ['active', 'invalid']);

// ============================================================================
// GITHUB ENUMS
// ============================================================================

/** GitHub account types (from GitHub API) */
export const githubAccountTypeEnum = pgEnum('github_account_type', ['Organization', 'User']);

/** GitHub App repository selection modes */
export const repositorySelectionEnum = pgEnum('repository_selection', ['all', 'selected']);

/** GitHub installation status */
export const githubInstallationStatusEnum = pgEnum('github_installation_status', [
  'active', // Working normally
  'suspended', // Suspended by GitHub/org admin
  'needs_permissions', // App permissions upgraded, installation not yet
  'error', // Auth failure or other error state
]);

/** GitHub installation sync status (for workflow tracking) */
export const syncStatusEnum = pgEnum('sync_status', [
  'idle', // No sync in progress
  'pending', // Workflow queued but not started
  'in_progress', // Workflow executing
  'failed', // Last sync failed
]);

// ============================================================================
// WORKFLOW ENUMS
// ============================================================================

/** Workflow execution phases */
export const workflowPhaseEnum = pgEnum('workflow_phase', [
  'pending', // Created, not yet started
  'provisioning', // Setting up environment
  'cloning', // Cloning repository
  'executing', // Running agent
  'capturing', // Capturing changes
  'cleanup', // Cleaning up resources
  'completed', // Successfully finished
  'failed', // Terminated due to error
  'cancelled', // User-initiated cancellation
]);

/** Workflow task types */
export const workflowTaskTypeEnum = pgEnum('workflow_task_type', [
  'analysis', // Read-only analysis
  'remediation', // Fix issues on existing PR
  'implementation', // Create new branch/PR
]);

/** Error categories for workflow failures */
export const errorCategoryEnum = pgEnum('error_category', [
  'retryable', // Transient errors (rate limits, network)
  'correctable', // User can fix (permissions, config)
  'terminal', // Unrecoverable (validation, logic errors)
]);

// ============================================================================
// PULL REQUEST ACTION ITEM ENUMS
// ============================================================================

/** Lifecycle status of a derived pull request action item */
export const actionItemStatusEnum = pgEnum('action_item_status', [
  'pending', // Outstanding work
  'in_progress', // Worked since first seen but not yet resolved
  'done', // Resolved (thread resolved / check passing / human-checked)
]);

/** What a pull request action item was derived from */
export const actionItemSourceTypeEnum = pgEnum('action_item_source_type', [
  'review_comment', // A pull request review thread comment
  'issue_comment', // A top-level issue comment on the pull request
  'review', // A CHANGES_REQUESTED review body
  'ci_check_run', // A failing CI check run
  'ci_annotation', // A CI check annotation
  'composite', // Aggregated from multiple sources
]);

// ============================================================================
// DERIVED TYPESCRIPT TYPES
// ============================================================================

export type AuthProvider = (typeof authProviderEnum.enumValues)[number];
export type OAuthProvider = (typeof oauthProviderEnum.enumValues)[number];
export type OAuthConnectionStatus = (typeof oauthConnectionStatusEnum.enumValues)[number];

// GitHub types
export type GitHubAccountType = (typeof githubAccountTypeEnum.enumValues)[number];
export type RepositorySelection = (typeof repositorySelectionEnum.enumValues)[number];
export type GitHubInstallationStatus = (typeof githubInstallationStatusEnum.enumValues)[number];
export type SyncStatus = (typeof syncStatusEnum.enumValues)[number];

// Workflow types
export type WorkflowPhase = (typeof workflowPhaseEnum.enumValues)[number];
export type WorkflowTaskType = (typeof workflowTaskTypeEnum.enumValues)[number];
export type ErrorCategory = (typeof errorCategoryEnum.enumValues)[number];

// Pull request action item types
export type ActionItemStatus = (typeof actionItemStatusEnum.enumValues)[number];
export type ActionItemSourceType = (typeof actionItemSourceTypeEnum.enumValues)[number];
