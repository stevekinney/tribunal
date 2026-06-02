/**
 * GitHub-level access verification for repositories.
 *
 * This module provides a second layer of authorization:
 * 1. App-level (existing): User owns project OR is org member
 * 2. GitHub-level (this): User can access repo via their personal GitHub OAuth token
 *
 * Key features:
 * - Conservative caching (never cache denials when scope is uncertain)
 * - Circuit breaker to prevent hammering GitHub during rate limits
 * - Request deduplication for concurrent access checks
 * - SSO detection and handling
 */

import { eq, and } from 'drizzle-orm';
import { oauthConnection } from '@tribunal/database/schema';
import { repository } from '@tribunal/database/schema';
import type { GithubServiceContext } from '../context.js';

/**
 * Function type for retrieving a user's OAuth connection.
 * The host application provides this to avoid coupling to SvelteKit auth.
 */
export type GetOAuthConnection = (
  userId: number,
  provider: 'github',
) => Promise<{ accessToken: string; scope: string | null } | null>;

// Configuration
const DEFAULT_GITHUB_ACCESS_CACHE_TTL = 300; // 5 min default
const GITHUB_ACCESS_SSO_CACHE_TTL = 60; // 1 min for SSO denials (fixed, short)
const CIRCUIT_FAILURE_THRESHOLD = 3;
const CIRCUIT_RESET_MS = 60_000; // 1 minute

// Logging configuration - sample rates to avoid log noise
const LOG_SAMPLE_RATE_SUCCESS = 0.01; // 1% of successful accesses
const LOG_SAMPLE_RATE_DENIAL_NORMAL = 0.1; // 10% of no_access denials
// These are ALWAYS logged (100%) for debugging/security
const ALWAYS_LOG_REASONS: GitHubAccessDenialReason[] = [
  'invalid_token',
  'sso_required',
  'insufficient_scope',
  'rate_limited',
  'repository_blocked',
  'account_suspended',
];

// Types
export type GitHubAccessDenialReason =
  | 'no_token'
  | 'invalid_token'
  | 'insufficient_scope'
  | 'sso_required'
  | 'no_access'
  | 'rate_limited'
  | 'repository_blocked'
  | 'account_suspended';

export type GitHubAccessResult =
  | { allowed: true; visibility: 'public' | 'private' }
  | {
      allowed: false;
      reason: GitHubAccessDenialReason;
      ssoUrl?: string;
      ssoOrgLogin?: string;
      message: string;
      retryAfter?: number;
    };

export interface UserScopes {
  hasRepo: boolean;
  hasPublicRepo: boolean;
  hasNone: boolean;
  unknown: boolean;
}

interface GitHubAccessCacheEntry {
  result: GitHubAccessResult;
  cachedAt: number;
  lastSuccessAt?: number;
}

interface CircuitState {
  failures: number;
  lastFailure: number;
  openUntil: number;
}

// In-memory state (per-process)
const pendingChecks = new Map<string, Promise<GitHubAccessResult>>();
const circuitBreakers = new Map<string, CircuitState>();

// Retry configuration for gateway errors
const RETRY_CONFIG = {
  maxAttempts: 2,
  minDelayMs: 500,
  maxDelayMs: 2000,
};

// Gateway errors that should be retried
const RETRIABLE_STATUS_CODES = [502, 503, 504];

/**
 * Retry wrapper for fetch operations.
 * Only retries on gateway errors (502/503/504) and network errors.
 * Does NOT retry on auth/rate-limit/access errors.
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  isRetriable: (error: unknown) => boolean,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < RETRY_CONFIG.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isRetriable(error) || attempt === RETRY_CONFIG.maxAttempts - 1) {
        throw error;
      }
      // Exponential backoff
      const delay = Math.min(
        RETRY_CONFIG.minDelayMs * Math.pow(2, attempt),
        RETRY_CONFIG.maxDelayMs,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

// Cache key helpers
const CACHE_KEYS = {
  GITHUB_ACCESS: (userId: number, repositoryId: number) =>
    `github-access:${userId}:${repositoryId}`,
  GITHUB_ACCESS_USER_PATTERN: (userId: number) => `github-access:${userId}:*`,
  GITHUB_ACCESS_REPO_PATTERN: (repositoryId: number) => `github-access:*:${repositoryId}`,
};

// Audit logging
interface GitHubAccessAuditLog {
  timestamp: Date;
  userId: number;
  repositoryId: number;
  action: 'view' | 'check';
  result: 'allowed' | 'denied';
  denialReason?: GitHubAccessDenialReason;
  cached: boolean;
  latencyMs?: number;
  // NEVER log: accessToken, ssoUrl, repositoryFullName, orgLogin (privacy)
}

/**
 * Determine if this access attempt should be logged based on sampling.
 */
function shouldLogAccess(result: 'allowed' | 'denied', reason?: GitHubAccessDenialReason): boolean {
  if (result === 'allowed') {
    return Math.random() < LOG_SAMPLE_RATE_SUCCESS;
  }

  // Always log important denial types for debugging
  if (reason && ALWAYS_LOG_REASONS.includes(reason)) {
    return true; // 100% logging for important errors
  }

  // Sample normal denials (no_access, no_token)
  return Math.random() < LOG_SAMPLE_RATE_DENIAL_NORMAL;
}

/**
 * Log an access attempt with privacy-safe structured logging.
 */
function logAccessAttempt(log: GitHubAccessAuditLog): void {
  if (!shouldLogAccess(log.result, log.denialReason)) return;

  // Use structured logging with minimal, privacy-safe fields
  console.log(
    JSON.stringify({
      type: 'github_access_audit',
      ts: log.timestamp.toISOString(),
      uid: log.userId,
      rid: log.repositoryId, // ID only, never name
      act: log.action,
      res: log.result,
      reason: log.denialReason,
      cached: log.cached,
      ms: log.latencyMs,
      // SANITIZED: no repo names, org names, SSO URLs, tokens
    }),
  );
}

/**
 * Parse stored scope string into structured format.
 */
export function parseScopes(storedScope: string | null): UserScopes {
  if (!storedScope) {
    return { hasRepo: false, hasPublicRepo: false, hasNone: false, unknown: true };
  }

  const scopes = storedScope.split(',').map((s) => s.trim().toLowerCase());

  return {
    hasRepo: scopes.includes('repo'),
    hasPublicRepo: scopes.includes('public_repo'),
    hasNone: !scopes.includes('repo') && !scopes.includes('public_repo'),
    unknown: false,
  };
}

/**
 * Parse X-GitHub-SSO header.
 * Format: "required; url=https://github.com/orgs/ORG/sso?authorization_request=..."
 */
export function parseSsoHeader(
  header: string,
): { type: 'required' | 'partial-results'; orgLogin: string; authUrl: string } | null {
  const match = header.match(/^(required|partial-results);\s*url=(.+)$/);
  if (!match) return null;

  const [, type, authUrl] = match;
  const orgMatch = authUrl.match(/\/orgs\/([^/]+)\//);
  if (!orgMatch) return null;

  return {
    type: type as 'required' | 'partial-results',
    orgLogin: orgMatch[1],
    authUrl,
  };
}

/**
 * Determine if a denial should be cached based on reason and user scopes.
 */
function shouldCacheDenial(
  reason: GitHubAccessDenialReason,
  userScopes: UserScopes,
  lastSuccessAt: number | undefined,
  cacheTtl: number,
): { cache: boolean; ttl: number } {
  const recentSuccess = lastSuccessAt && Date.now() - lastSuccessAt < 3600_000; // 1 hour
  const hasMinimalScope = userScopes.hasNone || userScopes.unknown || userScopes.hasPublicRepo;

  switch (reason) {
    case 'invalid_token':
      return { cache: false, ttl: 0 }; // Never cache - user may reauth

    case 'rate_limited':
      return { cache: false, ttl: 0 }; // Never cache - transient

    case 'sso_required':
      return { cache: true, ttl: GITHUB_ACCESS_SSO_CACHE_TTL }; // 1 min - user may auth quickly

    case 'insufficient_scope':
      return { cache: false, ttl: 0 }; // Never cache - user may upgrade

    case 'no_access':
      // CONSERVATIVE: Never cache no_access when we're uncertain about scope
      if (recentSuccess) {
        return { cache: false, ttl: 0 }; // Had access recently - GitHub wobble
      }
      if (hasMinimalScope) {
        return { cache: false, ttl: 0 }; // Might need upgrade
      }
      // User has full repo scope AND no recent success - truly no access
      return { cache: true, ttl: cacheTtl };

    case 'repository_blocked':
      return { cache: true, ttl: 300 }; // 5 min - unlikely to change quickly

    case 'account_suspended':
      return { cache: true, ttl: 300 }; // 5 min - user must resolve with GitHub

    case 'no_token':
      return { cache: false, ttl: 0 }; // Never cache - user may connect

    default:
      return { cache: false, ttl: 0 };
  }
}

/**
 * Get repository by ID from database.
 */
async function getRepositoryById(
  context: GithubServiceContext,
  repositoryId: number,
): Promise<{ id: number; owner: string; name: string; installationId: number | null } | null> {
  const [repo] = await context.db
    .select({
      id: repository.id,
      owner: repository.owner,
      name: repository.name,
      installationId: repository.installationId,
    })
    .from(repository)
    .where(eq(repository.id, repositoryId))
    .limit(1);

  return repo ?? null;
}

/**
 * Check if a repository is public (unauthenticated check).
 */
async function checkPublicAccess(owner: string, repo: string): Promise<GitHubAccessResult | null> {
  try {
    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: {
        'User-Agent': 'tribunal',
        Accept: 'application/vnd.github+json',
      },
    });

    if (response.ok) {
      const data = await response.json();
      if (!data.private) {
        return { allowed: true, visibility: 'public' };
      }
    }

    // 404 or private - need authenticated check
    return null;
  } catch {
    // Network error - continue to authenticated check
    return null;
  }
}

// Custom error class for retriable gateway errors
class GatewayError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'GatewayError';
  }
}

/**
 * Check repository access with user's OAuth token.
 * Retries on gateway errors (502/503/504) and network errors.
 */
async function checkWithUserToken(
  token: string,
  owner: string,
  repo: string,
): Promise<GitHubAccessResult> {
  const doFetch = async (): Promise<Response> => {
    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'User-Agent': 'tribunal',
        Accept: 'application/vnd.github+json',
      },
    });

    // Throw retriable error for gateway errors
    if (RETRIABLE_STATUS_CODES.includes(response.status)) {
      throw new GatewayError(response.status, `Gateway error: ${response.status}`);
    }

    return response;
  };

  try {
    // Retry on gateway errors and network errors
    const response = await withRetry(doFetch, (error) => {
      // Retry network errors
      if (error instanceof TypeError) return true;
      // Retry gateway errors
      if (error instanceof GatewayError) return true;
      return false;
    });

    // Check for SSO header FIRST (even on 403)
    const ssoHeader = response.headers.get('X-GitHub-SSO');
    if (ssoHeader) {
      const sso = parseSsoHeader(ssoHeader);
      if (sso) {
        return {
          allowed: false,
          reason: 'sso_required',
          ssoUrl: sso.authUrl,
          ssoOrgLogin: sso.orgLogin,
          message: `Your organization "${sso.orgLogin}" requires SSO authorization`,
        };
      }
    }

    if (response.ok) {
      const data = await response.json();
      return { allowed: true, visibility: data.private ? 'private' : 'public' };
    }

    if (response.status === 401) {
      return {
        allowed: false,
        reason: 'invalid_token',
        message: 'GitHub token expired or revoked',
      };
    }

    // Handle 429 FIRST - secondary rate limit (abuse detection)
    if (response.status === 429) {
      const retryAfter = parseInt(
        response.headers.get('Retry-After') ?? response.headers.get('retry-after') ?? '60',
        10,
      );
      return {
        allowed: false,
        reason: 'rate_limited',
        message: `GitHub API rate limit exceeded. Please try again in ${retryAfter} seconds.`,
        retryAfter,
      };
    }

    if (response.status === 403) {
      // Check for primary rate limit
      const remaining = response.headers.get('X-RateLimit-Remaining');
      const resetTimestamp = response.headers.get('X-RateLimit-Reset');

      if (remaining === '0' && resetTimestamp) {
        const resetAt = parseInt(resetTimestamp, 10);
        const retryAfter = Math.max(0, resetAt - Math.floor(Date.now() / 1000));
        return {
          allowed: false,
          reason: 'rate_limited',
          message: `GitHub API rate limit exceeded. Please try again in ${retryAfter} seconds.`,
          retryAfter,
        };
      }

      // Check for repository blocked (DMCA/ToS violations) or account suspended
      try {
        const body = await response.json();
        if (
          body.message?.includes('access blocked') ||
          body.message?.includes('Repository access blocked')
        ) {
          return {
            allowed: false,
            reason: 'repository_blocked',
            message: 'This repository has been blocked by GitHub',
          };
        }
        // Check for account suspension
        if (body.message?.includes('suspended')) {
          return {
            allowed: false,
            reason: 'account_suspended',
            message: 'There is an issue with your GitHub account',
          };
        }
      } catch {
        // Ignore JSON parse errors
      }

      // 403 without SSO header = scope insufficient or other permission issue
      return {
        allowed: false,
        reason: 'insufficient_scope',
        message: 'Token lacks required permissions',
      };
    }

    if (response.status === 404) {
      return {
        allowed: false,
        reason: 'no_access',
        message: 'Repository not accessible',
      };
    }

    // Other errors - treat as transient
    return {
      allowed: false,
      reason: 'no_access',
      message: 'Unable to verify access',
    };
  } catch {
    // Network error
    return {
      allowed: false,
      reason: 'no_access',
      message: 'Unable to verify GitHub access. Please try again.',
    };
  }
}

/**
 * Get cached access entry including lastSuccessAt.
 */
async function getCachedAccessEntry(
  context: GithubServiceContext,
  userId: number,
  repositoryId: number,
): Promise<GitHubAccessCacheEntry | null> {
  const key = CACHE_KEYS.GITHUB_ACCESS(userId, repositoryId);
  return context.cache.getCached<GitHubAccessCacheEntry>(key);
}

/**
 * Get cached access result (convenience wrapper).
 */
async function getCachedAccess(
  context: GithubServiceContext,
  userId: number,
  repositoryId: number,
): Promise<GitHubAccessResult | null> {
  const entry = await getCachedAccessEntry(context, userId, repositoryId);
  return entry?.result ?? null;
}

/**
 * Cache access result based on caching rules.
 */
async function cacheResult(
  context: GithubServiceContext,
  userId: number,
  repositoryId: number,
  result: GitHubAccessResult,
  scopes: UserScopes,
  cacheTtl: number,
  lastSuccessAt?: number,
): Promise<void> {
  const key = CACHE_KEYS.GITHUB_ACCESS(userId, repositoryId);

  if (result.allowed) {
    // Always cache successful access
    const entry: GitHubAccessCacheEntry = {
      result,
      cachedAt: Date.now(),
      lastSuccessAt: Date.now(),
    };
    await context.cache.setCache(key, entry, cacheTtl);
  } else {
    // Check if we should cache this denial
    const { cache, ttl } = shouldCacheDenial(result.reason, scopes, lastSuccessAt, cacheTtl);
    if (cache && ttl > 0) {
      const entry: GitHubAccessCacheEntry = {
        result,
        cachedAt: Date.now(),
        lastSuccessAt,
      };
      await context.cache.setCache(key, entry, ttl);
    }
  }
}

/**
 * Resolve repository and verify access (inside circuit breaker).
 */
async function resolveAndVerifyAccess(
  context: GithubServiceContext,
  getOAuthConnection: GetOAuthConnection,
  userId: number,
  repositoryId: number,
  cacheTtl: number,
): Promise<GitHubAccessResult> {
  // 1. Resolve repo from DB (handles renames)
  const repo = await getRepositoryById(context, repositoryId);
  if (!repo) {
    return { allowed: false, reason: 'no_access', message: 'Repository not found' };
  }
  const { owner, name: repoName } = repo;

  // 1a. Get existing cache entry for lastSuccessAt preservation
  const existingEntry = await getCachedAccessEntry(context, userId, repositoryId);
  const lastSuccessAt = existingEntry?.lastSuccessAt;

  // 2. Get user token/scopes
  const connection = await getOAuthConnection(userId, 'github');
  if (!connection?.accessToken) {
    return {
      allowed: false,
      reason: 'no_token',
      message: 'Connect GitHub to access this repository',
    };
  }
  const scopes = parseScopes(connection.scope ?? null);

  // 3. Try public repo check first (works without auth)
  const publicResult = await checkPublicAccess(owner, repoName);
  if (publicResult?.allowed && publicResult.visibility === 'public') {
    await cacheResult(context, userId, repositoryId, publicResult, scopes, cacheTtl, lastSuccessAt);
    return publicResult;
  }

  // 4. Authenticated check
  const authResult = await checkWithUserToken(connection.accessToken, owner, repoName);

  // 4a. Handle invalid token - mark in DB and clear cache
  if (!authResult.allowed && authResult.reason === 'invalid_token') {
    await markGitHubTokenInvalid(context, userId);
    await invalidateGitHubAccessCache(context, userId); // Clear all cached access for this user
    return authResult;
  }

  // 5. CRITICAL: Scope-based 404/403 decision
  if (!authResult.allowed && authResult.reason === 'no_access') {
    if (scopes.hasRepo) {
      // Full scope but still denied - genuinely no access, cache it
      await cacheResult(context, userId, repositoryId, authResult, scopes, cacheTtl, lastSuccessAt);
      return authResult; // Will become 404 upstream
    } else {
      // Unknown/minimal scope + 404 - might be scope issue
      // DON'T CACHE - return as insufficient_scope for 403 with CTA
      return {
        allowed: false,
        reason: 'insufficient_scope',
        message: 'This may be a private repository. Sign in again to access it.',
      };
    }
  }

  // 6. Other results - cache per shouldCacheDenial rules
  await cacheResult(context, userId, repositoryId, authResult, scopes, cacheTtl, lastSuccessAt);
  return authResult;
}

/**
 * Circuit breaker wrapper for access verification.
 */
async function verifyWithCircuitBreaker(
  context: GithubServiceContext,
  getOAuthConnection: GetOAuthConnection,
  userId: number,
  repoId: number,
  cacheTtl: number,
): Promise<GitHubAccessResult> {
  const circuitKey = `${userId}:${repoId}`;
  const circuit = circuitBreakers.get(circuitKey);

  // Circuit open? Return early without hitting GitHub
  if (circuit && circuit.openUntil > Date.now()) {
    const retryAfter = Math.ceil((circuit.openUntil - Date.now()) / 1000);
    return {
      allowed: false,
      reason: 'rate_limited',
      message: `Access check temporarily unavailable. Please try again in ${retryAfter} seconds.`,
      retryAfter,
    };
  }

  // Deduplicate concurrent requests
  const pending = pendingChecks.get(circuitKey);
  if (pending) return pending;

  // ALL WORK HAPPENS HERE - inside circuit breaker
  const promise = resolveAndVerifyAccess(
    context,
    getOAuthConnection,
    userId,
    repoId,
    cacheTtl,
  ).finally(() => {
    pendingChecks.delete(circuitKey);
  });

  pendingChecks.set(circuitKey, promise);
  const result = await promise;

  // Update circuit state
  if (!result.allowed && result.reason === 'rate_limited') {
    const state = circuit ?? { failures: 0, lastFailure: 0, openUntil: 0 };
    state.failures++;
    state.lastFailure = Date.now();
    if (state.failures >= CIRCUIT_FAILURE_THRESHOLD) {
      state.openUntil = Date.now() + CIRCUIT_RESET_MS;
    }
    circuitBreakers.set(circuitKey, state);
  } else {
    circuitBreakers.delete(circuitKey); // Reset on success
  }

  return result;
}

/**
 * Main entry point - verify GitHub repository access.
 *
 * @param context - The GitHub service context (db, cache)
 * @param getOAuthConnection - Function to retrieve user's OAuth connection
 * @param userId - The user ID to check access for
 * @param repositoryId - The repository ID (from our database)
 * @param options - Optional settings (e.g., skipCache for admin/sensitive actions, cacheTtl override)
 */
export async function verifyGitHubRepositoryAccess(
  context: GithubServiceContext,
  getOAuthConnection: GetOAuthConnection,
  userId: number,
  repositoryId: number,
  options?: { skipCache?: boolean; cacheTtl?: number },
): Promise<GitHubAccessResult> {
  const startTime = Date.now();
  const cacheTtl = options?.cacheTtl ?? DEFAULT_GITHUB_ACCESS_CACHE_TTL;

  // 1. Check cache first (unless skipCache)
  if (!options?.skipCache) {
    const cachedResult = await getCachedAccess(context, userId, repositoryId);
    if (cachedResult) {
      // Log cached access
      logAccessAttempt({
        timestamp: new Date(),
        userId,
        repositoryId,
        action: 'check',
        result: cachedResult.allowed ? 'allowed' : 'denied',
        denialReason: !cachedResult.allowed ? cachedResult.reason : undefined,
        cached: true,
        latencyMs: Date.now() - startTime,
      });
      return cachedResult;
    }
  }

  // 2. All further work goes through circuit breaker
  const result = await verifyWithCircuitBreaker(
    context,
    getOAuthConnection,
    userId,
    repositoryId,
    cacheTtl,
  );

  // Log the access check result
  logAccessAttempt({
    timestamp: new Date(),
    userId,
    repositoryId,
    action: 'check',
    result: result.allowed ? 'allowed' : 'denied',
    denialReason: !result.allowed ? result.reason : undefined,
    cached: false,
    latencyMs: Date.now() - startTime,
  });

  return result;
}

/**
 * Invalidate GitHub access cache for a user (all repos or specific repo).
 */
export async function invalidateGitHubAccessCache(
  context: GithubServiceContext,
  userId: number,
  repositoryId?: number,
): Promise<void> {
  if (repositoryId !== undefined) {
    // Specific user+repo
    const key = CACHE_KEYS.GITHUB_ACCESS(userId, repositoryId);
    await context.cache.deleteCache(key);
  } else {
    // All repos for this user
    const pattern = CACHE_KEYS.GITHUB_ACCESS_USER_PATTERN(userId);
    await context.cache.deleteCacheByPattern(pattern);
  }
}

/**
 * Invalidate GitHub access cache for a repository (all users).
 */
export async function invalidateAllAccessCacheForRepo(
  context: GithubServiceContext,
  repositoryId: number,
): Promise<void> {
  const pattern = CACHE_KEYS.GITHUB_ACCESS_REPO_PATTERN(repositoryId);
  await context.cache.deleteCacheByPattern(pattern);
}

/**
 * Mark a user's GitHub token as invalid in the database.
 * Called when we receive a 401 from GitHub.
 */
export async function markGitHubTokenInvalid(
  context: GithubServiceContext,
  userId: number,
): Promise<void> {
  try {
    await context.db
      .update(oauthConnection)
      .set({
        status: 'invalid',
        updatedAt: new Date(),
      })
      .where(eq(oauthConnection.userId, userId));
  } catch (e) {
    console.error('Failed to mark GitHub token as invalid:', e);
  }
}

/**
 * Mark GitHub tokens as invalid for a GitHub user ID.
 * Called when we receive a github_app_authorization.revoked webhook.
 * Returns the internal user IDs whose tokens were invalidated.
 */
export async function markGitHubTokensInvalidByProviderUserId(
  context: GithubServiceContext,
  githubUserId: number,
): Promise<number[]> {
  try {
    // Update all connections for this GitHub user and return affected user IDs
    // Using RETURNING to do this atomically in a single query
    const updated = await context.db
      .update(oauthConnection)
      .set({
        status: 'invalid',
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(oauthConnection.provider, 'github'),
          eq(oauthConnection.providerUserId, String(githubUserId)),
        ),
      )
      .returning({ userId: oauthConnection.userId });

    return updated.map((row) => row.userId);
  } catch (e) {
    console.error('Failed to mark GitHub tokens as invalid by provider user ID:', e);
    return [];
  }
}
