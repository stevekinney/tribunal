import { pgEnum } from 'drizzle-orm/pg-core';

// ============================================================================
// AUTH ENUMS
// ============================================================================

/** Supported authentication providers for auth_account (login identity) */
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
// DERIVED TYPESCRIPT TYPES
// ============================================================================

// Auth types
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
