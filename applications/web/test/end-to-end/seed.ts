/**
 * E2E Test Seeding Module
 *
 * Provides deterministic seeding functions for E2E tests.
 * These functions create real database records that can be used
 * in Playwright tests without requiring GitHub OAuth.
 *
 * IMPORTANT: This module should ONLY be used in E2E test mode.
 * The endpoints that use these functions are protected by E2E_TEST_MODE
 * and E2E_TEST_SECRET environment variables.
 */

import type { PgliteDatabase } from 'drizzle-orm/pglite';
import { encodeBase64url } from '@oslojs/encoding';
import {
  user,
  session as sessionTable,
  authAccount,
  repository as repositoryTable,
} from '@tribunal/database/schema';
import type * as schema from '@tribunal/database/schema';
import type { User, Session, Repository } from '@tribunal/database/schema';

type E2EDatabase = PgliteDatabase<typeof schema>;

export interface SeedUserOptions {
  username?: string;
  name?: string;
  email?: string;
  avatarUrl?: string;
}

export interface SeededUser {
  user: User;
  session: Session;
  token: string;
}

export interface SeedRepositoryOptions {
  id?: number;
  owner?: string;
  name?: string;
  installationId?: number | null;
  uri?: string;
}

export interface SeededRepository {
  repository: Repository;
}

/**
 * Generates a secure session token (same format as production)
 * Uses encodeBase64url from @oslojs/encoding for consistency with authentication.ts
 */
function generateSessionToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return encodeBase64url(bytes);
}

/**
 * Hashes a token using SHA-256 to hex (same as production authentication.ts)
 */
async function hashTokenHex(token: string): Promise<string> {
  const data = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(digest);
  let hex = '';
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
}

/**
 * Creates a session using the same logic as production.
 * Uses SHA-256 hex hashing (matching authentication.ts createSession).
 */
async function createE2ESession(db: E2EDatabase, token: string, userId: number): Promise<Session> {
  const sessionId = await hashTokenHex(token);
  const now = new Date();
  const DAY_IN_MS = 1000 * 60 * 60 * 24;

  const [session] = await db
    .insert(sessionTable)
    .values({
      id: sessionId,
      userId,
      expiresAt: new Date(Date.now() + DAY_IN_MS * 30),
      lastAuthAt: now,
    })
    .returning();

  return session;
}

// Per-worker counters for unique ID generation within a test run
// Each worker maintains its own counter for parallel test isolation
const workerSeedCounters = new Map<string, number>();
const DEFAULT_WORKER_ID = 'default';

/**
 * Gets the next seed ID for a worker (thread-safe within a single process)
 */
function getNextSeedId(workerId?: string): number {
  const id = workerId ?? DEFAULT_WORKER_ID;
  const current = workerSeedCounters.get(id) ?? 1;
  workerSeedCounters.set(id, current + 1);
  return current;
}

/**
 * Reset the seed counter for a specific worker (called during E2E reset)
 */
export function resetSeedCounter(workerId?: string): void {
  const id = workerId ?? DEFAULT_WORKER_ID;
  workerSeedCounters.set(id, 1);
}

/**
 * Seeds a test user with a valid session.
 *
 * This creates:
 * - A user record in the database
 * - A session record using production-compatible token hashing
 * - Returns the raw token for cookie setting
 *
 * @param db - The E2E database instance
 * @param options - Optional overrides for user properties
 * @param workerId - Worker ID for per-worker seed counter isolation
 * @returns The created user, session, and raw token
 */
export async function seedE2EUser(
  db: E2EDatabase,
  options: SeedUserOptions = {},
  workerId?: string,
): Promise<SeededUser> {
  const id = getNextSeedId(workerId);

  // Create user
  const [createdUser] = await db
    .insert(user)
    .values({
      username: options.username ?? `e2e-user-${id}`,
      name: options.name ?? `E2E Test User ${id}`,
      email: options.email ?? `e2e-user-${id}@test.local`,
      avatarUrl: options.avatarUrl ?? `https://api.dicebear.com/7.x/identicon/svg?seed=e2e-${id}`,
    })
    .returning();

  // Generate token and create session using production-compatible method
  const token = generateSessionToken();
  const session = await createE2ESession(db, token, createdUser.id);

  // Create a GitHub auth account for the user (for compatibility with auth checks)
  await db.insert(authAccount).values({
    userId: createdUser.id,
    provider: 'github',
    providerUserId: `e2e-github-${id}`,
    providerUsername: createdUser.username,
    email: createdUser.email,
  });

  return { user: createdUser, session, token };
}

/**
 * Seeds a repository in the flat data model.
 *
 * @param db - The E2E database instance
 * @param options - Optional overrides for repository properties
 * @param workerId - Worker ID for per-worker seed counter isolation
 * @returns The created repository
 */
export async function seedRepository(
  db: E2EDatabase,
  options: SeedRepositoryOptions = {},
  workerId?: string,
): Promise<SeededRepository> {
  const id = getNextSeedId(workerId);
  const repositoryId = options.id ?? 200000000 + id;
  const owner = options.owner ?? `e2e-owner-${id}`;
  const name = options.name ?? `e2e-repository-${id}`;

  const [repository] = await db
    .insert(repositoryTable)
    .values({
      id: repositoryId,
      owner,
      name,
      uri: options.uri ?? `https://github.com/${owner}/${name}.git`,
      installationId: options.installationId ?? 1,
    })
    .returning();

  return { repository };
}

/**
 * Gets the E2E database instance for a specific worker.
 * This function throws if called outside of E2E mode.
 *
 * @param workerId - The worker ID (from Playwright's TEST_WORKER_INDEX or request header)
 */
export async function getE2EDatabase(workerId?: string): Promise<E2EDatabase> {
  // Dynamic import to avoid loading PGlite in production
  const { getE2EDatabaseInstance } = await import('$testing/end-to-end/database');
  return getE2EDatabaseInstance(workerId);
}
