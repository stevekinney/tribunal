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
import type { WeftClient } from '@lostgradient/weft/client';
import type { createCache } from './cache.js';
import type { Octokit, App } from 'octokit';

/**
 * Which atomic path a Weft `startOrSignal` call took: `'started'` (a fresh run
 * was created) or `'signalled'` (the event was coalesced onto a live run) — the
 * weft#466 outcome distinction.
 *
 * Re-exported from `@lostgradient/weft/client`, where 0.5.0 publishes the type by
 * name (weft#583). The producers annotate their result interfaces with it; this
 * package re-exports it so they import a single name from one place.
 */
export type { StartOrSignalOutcome } from '@lostgradient/weft/client';

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

  /**
   * Lazily resolve the Weft durable-execution client.
   *
   * A resolver (not a resolved value) so the host can defer building the engine
   * until the first dispatch, rather than at context-construction time — this
   * keeps web-app startup from blocking on `Engine.create` + `recoverAll()`.
   * Resolves to a {@link WeftClient} when an engine is configured, or `null`
   * when it is not; producers fall back to log-only on `null`, so webhook
   * delivery acceptance is never blocked on the engine. Omitted entirely in
   * hosts that have no Weft integration.
   */
  resolveWeftClient?: () => Promise<WeftClient | null>;
}
