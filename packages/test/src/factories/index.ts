/**
 * Test data factories for creating mock entities.
 *
 * These factories work with the test database to create real database records
 * for integration testing. Each factory returns the created entity with its
 * database-generated ID.
 *
 * Usage:
 * ```ts
 * import { createTestDatabase } from '@tribunal/test/database';
 * import { createUserFactory } from '@tribunal/test/factories';
 *
 * const testDb = await createTestDatabase();
 * const userFactory = createUserFactory(testDb.db);
 *
 * const user = await userFactory.create({ username: 'testuser' });
 * ```
 */

// Core utilities
export { generateId, resetIdCounter, type Database } from './core';

// User & Session
export { createUserFactory, type UserFactory, type UserFactoryInput } from './user';
export { createSessionFactory, type SessionFactory, type SessionFactoryInput } from './session';
export {
  createUserApiKeyFactory,
  type UserApiKeyFactory,
  type UserApiKeyFactoryInput,
} from './user-api-key';

// Auth
export {
  createAuthenticationAccountFactory,
  type AuthenticationAccountFactory,
  type AuthenticationAccountFactoryInput,
} from './auth-account';

// GitHub
export {
  createGitHubInstallationFactory,
  type GitHubInstallationFactory,
  type GitHubInstallationFactoryInput,
} from './github-installation';
export {
  createWebhookDeliveryFactory,
  type WebhookDeliveryFactory,
  type WebhookDeliveryFactoryInput,
} from './webhook-delivery';
export {
  createRepositoryFactory,
  type RepositoryFactory,
  type RepositoryFactoryInput,
} from './repository';

// OAuth
export {
  createOAuthConnectionFactory,
  type OAuthConnectionFactory,
  type OAuthConnectionFactoryInput,
} from './oauth-connection';

// Workflow
export {
  createWorkflowRunFactory,
  type WorkflowRunFactory,
  type WorkflowRunFactoryInput,
} from './workflow-run';

// ============================================================================
// COMBINED FACTORY HELPER
// ============================================================================

import type { Database } from './core';
import { createUserFactory, type UserFactory } from './user';
import { createSessionFactory, type SessionFactory } from './session';
import {
  createAuthenticationAccountFactory,
  type AuthenticationAccountFactory,
} from './auth-account';
import {
  createGitHubInstallationFactory,
  type GitHubInstallationFactory,
} from './github-installation';
import { createWebhookDeliveryFactory, type WebhookDeliveryFactory } from './webhook-delivery';
import { createRepositoryFactory, type RepositoryFactory } from './repository';
import { createWorkflowRunFactory, type WorkflowRunFactory } from './workflow-run';
import { createUserApiKeyFactory, type UserApiKeyFactory } from './user-api-key';
import { createOAuthConnectionFactory, type OAuthConnectionFactory } from './oauth-connection';

export interface AllFactories {
  user: UserFactory;
  session: SessionFactory;
  authAccount: AuthenticationAccountFactory;
  githubInstallation: GitHubInstallationFactory;
  webhookDelivery: WebhookDeliveryFactory;
  repository: RepositoryFactory;
  workflowRun: WorkflowRunFactory;
  userApiKey: UserApiKeyFactory;
  oauthConnection: OAuthConnectionFactory;
}

/**
 * Creates all factories for a given database instance
 */
export function createFactories(db: Database): AllFactories {
  return {
    user: createUserFactory(db),
    session: createSessionFactory(db),
    authAccount: createAuthenticationAccountFactory(db),
    githubInstallation: createGitHubInstallationFactory(db),
    webhookDelivery: createWebhookDeliveryFactory(db),
    repository: createRepositoryFactory(db),
    workflowRun: createWorkflowRunFactory(db),
    userApiKey: createUserApiKeyFactory(db),
    oauthConnection: createOAuthConnectionFactory(db),
  };
}
