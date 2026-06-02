/**
 * E2E Test Database Module
 *
 * Provides PGlite-based in-memory databases for E2E testing.
 * This module is ONLY loaded when E2E_TEST_MODE is enabled.
 *
 * Supports per-worker database isolation for parallel test execution.
 * Each Playwright worker gets its own isolated PGlite instance, enabling
 * parallel E2E tests without data interference.
 *
 * The database is initialized lazily per worker ID and reused across requests.
 * Use the reset endpoint to clear data between tests for a specific worker.
 */

import { PGlite } from '@electric-sql/pglite';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import * as schema from '@tribunal/database/schema';

type E2EDatabase = PgliteDatabase<typeof schema>;

interface WorkerDatabaseInstance {
  client: PGlite;
  database: E2EDatabase;
}

// Map of worker ID to database instance for parallel test isolation
const workerDatabases = new Map<string, WorkerDatabaseInstance>();

// Map of worker ID to initialization promise to prevent race conditions
const initializationPromises = new Map<string, Promise<WorkerDatabaseInstance>>();

// Default worker ID for backwards compatibility (single-worker mode)
const DEFAULT_WORKER_ID = 'default';

/**
 * Resolves the pushSchema function from drizzle-kit.
 * This is used to apply the schema to the PGlite database.
 */
async function resolvePushSchema() {
  try {
    const { pushSchema } = await import('drizzle-kit/api');
    return pushSchema;
  } catch (error) {
    const originalMessage = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to load drizzle-kit/api. Make sure 'drizzle-kit' is installed. Original error: ${originalMessage}`,
    );
  }
}

/**
 * Applies the schema to the PGlite database using drizzle-kit's pushSchema.
 */
async function applySchema(db: E2EDatabase): Promise<void> {
  const pushSchema = await resolvePushSchema();

  // Type assertion needed: pushSchema expects PgDatabase<any, Record<string, never>, ...>
  // but PgliteDatabase<typeof schema> has schema attached. The API works correctly at runtime.
  const { apply, hasDataLoss, warnings, statementsToExecute } = await pushSchema(schema, db as any);

  if (hasDataLoss) {
    throw new Error(
      `E2E schema push would cause data loss.\nStatements to execute:\n${statementsToExecute.join('\n')}`,
    );
  }

  if (warnings.length > 0) {
    console.warn(
      `E2E schema push warnings: ${warnings.join(', ')}\nStatements to execute:\n${statementsToExecute.join('\n')}`,
    );
  }

  await apply();
}

/**
 * Initializes a database instance for a specific worker.
 * Uses per-worker promises to prevent race conditions during initialization.
 */
async function initializeWorkerDatabase(workerId: string): Promise<WorkerDatabaseInstance> {
  // If already initialized, return existing instance
  const existing = workerDatabases.get(workerId);
  if (existing) {
    return existing;
  }

  // If initialization is in progress, wait for it
  const pendingPromise = initializationPromises.get(workerId);
  if (pendingPromise) {
    return pendingPromise;
  }

  // Start initialization with cleanup on both success and failure
  const initPromise = (async () => {
    console.log(`[E2E Database] Initializing PGlite database for worker "${workerId}"...`);

    // Create client first - we need to track it for cleanup on failure
    const client = new PGlite();

    try {
      const database = drizzle(client, { schema });

      // Apply schema - this can throw
      await applySchema(database);

      const instance: WorkerDatabaseInstance = { client, database };

      // Only store after successful initialization
      workerDatabases.set(workerId, instance);

      console.log(`[E2E Database] PGlite database initialized for worker "${workerId}"`);
      return instance;
    } catch (error) {
      // Close the client to prevent resource leak on initialization failure
      try {
        await client.close();
      } catch (closeError) {
        console.warn(
          `[E2E Database] Failed to close PGlite client after init failure for worker "${workerId}":`,
          closeError,
        );
      }
      throw error;
    }
  })()
    .then((instance) => {
      // Clean up promise after successful initialization
      // Subsequent calls will use workerDatabases.get() directly
      initializationPromises.delete(workerId);
      return instance;
    })
    .catch((error) => {
      // Reset promise to allow retry on any failure
      initializationPromises.delete(workerId);
      throw error;
    });

  initializationPromises.set(workerId, initPromise);
  return initPromise;
}

/**
 * Gets the E2E database instance for a specific worker.
 * Initializes the database if it hasn't been created yet.
 *
 * @param workerId - The worker ID (from Playwright's TEST_WORKER_INDEX or request header)
 * @throws Error if called outside of E2E mode
 */
export async function getE2EDatabaseInstance(workerId?: string): Promise<E2EDatabase> {
  const id = workerId ?? DEFAULT_WORKER_ID;
  const instance = await initializeWorkerDatabase(id);
  return instance.database;
}

/**
 * Synchronous getter for E2E database instance.
 * Returns the database if already initialized, otherwise throws.
 *
 * Used by the db proxy in hooks.server.ts after the database
 * has been initialized during the E2E login flow.
 *
 * @param workerId - The worker ID (from AsyncLocalStorage context)
 * @throws Error if database hasn't been initialized for this worker
 */
export function getE2EDatabaseInstanceSync(workerId?: string): E2EDatabase {
  const id = workerId ?? DEFAULT_WORKER_ID;
  const instance = workerDatabases.get(id);

  if (!instance) {
    throw new Error(
      `E2E database not initialized for worker "${id}". ` +
        `Ensure E2E login endpoint is called before accessing the database. ` +
        `If using parallel tests, make sure the worker ID is being passed correctly via the e2e-worker-id cookie.`,
    );
  }

  return instance.database;
}

/**
 * Gets the PGlite client for low-level operations like reset.
 *
 * @param workerId - The worker ID
 * @throws Error if database hasn't been initialized for this worker
 */
export function getE2EClient(workerId?: string): PGlite {
  const id = workerId ?? DEFAULT_WORKER_ID;
  const instance = workerDatabases.get(id);
  if (!instance) {
    throw new Error(`E2E database has not been initialized for worker "${id}"`);
  }
  return instance.client;
}

/**
 * Resets the E2E database for a specific worker by truncating all tables.
 * This is called by the reset endpoint between tests.
 *
 * If the database hasn't been initialized yet, it will be initialized first.
 * This makes reset safe to call at any point (before or after login).
 *
 * @param workerId - The worker ID to reset (only affects that worker's database)
 */
export async function resetE2EDatabase(workerId?: string): Promise<void> {
  const id = workerId ?? DEFAULT_WORKER_ID;

  // Initialize the database if it doesn't exist yet.
  // This ensures reset can be called before login without errors.
  const instance = await initializeWorkerDatabase(id);

  console.log(`[E2E Database] Resetting database for worker "${id}"...`);

  // Get all table names from pg_tables
  const results = await instance.client.exec(
    "SELECT quote_ident(tablename) AS name FROM pg_tables WHERE schemaname = 'public'",
  );

  type TableRow = { name: string };
  const tables = (results[0]?.rows as TableRow[] | undefined)?.map((row) => row.name) ?? [];

  // Filter out Drizzle's internal migrations table.
  // Note: quote_ident only adds quotes when necessary (e.g., for reserved words
  // or special characters). Since __drizzle_migrations is a valid simple identifier,
  // it may be returned unquoted. Check both forms to be safe.
  const userTables = tables.filter(
    (name) => name !== '__drizzle_migrations' && name !== '"__drizzle_migrations"',
  );

  if (userTables.length > 0) {
    await instance.client.exec(`TRUNCATE TABLE ${userTables.join(', ')} RESTART IDENTITY CASCADE`);
  }

  console.log(`[E2E Database] Database reset complete for worker "${id}"`);
}

/**
 * Gets the count of active worker databases.
 * Useful for debugging and monitoring.
 */
export function getActiveWorkerCount(): number {
  return workerDatabases.size;
}

/**
 * Closes and removes the E2E database for a specific worker.
 * This releases resources and allows garbage collection of the PGlite instance.
 *
 * Use this when:
 * - A worker has finished all its tests
 * - Memory pressure is high and you need to free resources
 * - Testing the database lifecycle explicitly
 *
 * Note: The database will be re-initialized if requested again via getE2EDatabaseInstance.
 *
 * @param workerId - The worker ID to close (only affects that worker's database)
 * @returns True if a database was closed, false if no database existed for that worker
 */
export async function closeE2EDatabase(workerId?: string): Promise<boolean> {
  const id = workerId ?? DEFAULT_WORKER_ID;
  const instance = workerDatabases.get(id);

  if (!instance) {
    return false;
  }

  try {
    await instance.client.close();
  } catch (error) {
    console.warn(`[E2E Database] Error closing database for worker "${id}":`, error);
  }

  workerDatabases.delete(id);
  initializationPromises.delete(id);

  console.log(`[E2E Database] Closed database for worker "${id}"`);
  return true;
}

/**
 * Closes all E2E databases and releases all resources.
 * Use this during server shutdown or test suite cleanup.
 *
 * @returns The number of databases that were closed
 */
export async function closeAllE2EDatabases(): Promise<number> {
  const workerIds = Array.from(workerDatabases.keys());
  let closedCount = 0;

  for (const id of workerIds) {
    const closed = await closeE2EDatabase(id);
    if (closed) closedCount++;
  }

  console.log(`[E2E Database] Closed ${closedCount} databases`);
  return closedCount;
}
