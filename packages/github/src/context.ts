/**
 * Dependency injection context for GitHub server operations.
 *
 * This interface abstracts the SvelteKit-specific singletons (database, cache,
 * GitHub App auth) so that server functions can live in this package without
 * importing from `$lib/server/*`.
 *
 * The host application (e.g. SvelteKit web app) creates a concrete context and
 * passes it to each function call.
 */
import type { Database } from '@tribunal/database';
import type { createCache } from './cache.js';
import type { Octokit, App } from 'octokit';

/** Cache operations — matches the return type of `createCache` from `./cache`. */
export type CacheOperations = ReturnType<typeof createCache>;

/** Function that returns an authenticated Octokit for a GitHub App installation. */
export type GetInstallationOctokit = (installationId: number) => Promise<Octokit | null>;

/** Function that returns the GitHub App instance (needed for token minting). */
export type GetGithubApplication = () => App | null;

export interface GithubServiceContext {
  /** Database query builder (Drizzle ORM). */
  db: Database;

  /** Redis cache operations. */
  cache: CacheOperations;

  /** Get an authenticated Octokit client for a GitHub App installation. */
  getInstallationOctokit: GetInstallationOctokit;

  /** Get the GitHub App instance — only required by token minting functions. */
  getGithubApplication?: GetGithubApplication;
}
