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
import { user, repository as repositoryTable } from '@tribunal/database/schema';
import type * as schema from '@tribunal/database/schema';
import type { User, Repository } from '@tribunal/database/schema';

type E2EDatabase = PgliteDatabase<typeof schema>;

export interface SeedUserOptions {
  username?: string;
  name?: string;
  email?: string;
  avatarUrl?: string;
  neonAuthUserId?: string;
}

export interface SeededUser {
  user: User;
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
 * Seeds a test user with a valid test-only Neon Auth bridge token.
 *
 * This creates:
 * - A user record in the database
 * - A Neon Auth user mapping
 * - Returns the raw E2E token for cookie setting
 *
 * @param db - The E2E database instance
 * @param options - Optional overrides for user properties
 * @param workerId - Worker ID for per-worker seed counter isolation
 * @returns The created user and raw token
 */
export async function seedE2EUser(
  db: E2EDatabase,
  options: SeedUserOptions = {},
  workerId?: string,
): Promise<SeededUser> {
  const id = getNextSeedId(workerId);

  // Create user
  const neonAuthUserId =
    options.neonAuthUserId ?? `e2e-neon-user-${workerId ?? DEFAULT_WORKER_ID}-${id}`;
  const [createdUser] = await db
    .insert(user)
    .values({
      username: options.username ?? `e2e-user-${id}`,
      neonAuthUserId,
      name: options.name ?? `E2E Test User ${id}`,
      email: options.email ?? `e2e-user-${id}@test.local`,
      avatarUrl: options.avatarUrl ?? `https://api.dicebear.com/7.x/identicon/svg?seed=e2e-${id}`,
    })
    .returning();

  const token = `e2e:${workerId ?? DEFAULT_WORKER_ID}:${createdUser.id}:${crypto.randomUUID()}`;

  return { user: createdUser, token };
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
