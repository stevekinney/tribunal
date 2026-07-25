/**
 * GitHub service context adapter for SvelteKit.
 *
 * Wires SvelteKit singletons (database, Redis cache, GitHub App) into the
 * `GithubServiceContext` interface expected by `@tribunal/github` package
 * functions.
 *
 * Route handlers and other SvelteKit code import `githubContext` from
 * this module and pass it as the first argument to package functions.
 */

import { db } from '$lib/server/database';
import {
  getCached,
  setCache,
  setCacheIndefinitely,
  deleteCache,
  deleteCacheByPattern,
  resetCacheClient,
} from '$lib/server/redis';
import {
  getInstallationOctokit,
  getGithubApplication,
} from '$lib/server/github/github-application';
import { getWeftClient } from '$lib/server/weft/engine';
import type { GithubServiceContext } from '@tribunal/github/context';

export const githubContext: GithubServiceContext = {
  db,
  cache: {
    getCached,
    setCache,
    setCacheIndefinitely,
    deleteCache,
    deleteCacheByPattern,
    resetCacheClient,
  },
  getInstallationOctokit,
  getGithubApplication,
  // Resolve the local Weft client lazily for local/test producers that still use
  // this context directly. Production installation sync goes through the engine
  // control endpoint; `WEFT_DATABASE_URL` remains owned by tribunal-engine.
  resolveWeftClient: getWeftClient,
};
