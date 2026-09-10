import { AsyncLocalStorage } from 'node:async_hooks';
import { drizzle as drizzleNeonHttp } from 'drizzle-orm/neon-http';
import { drizzle as drizzleNodePostgres } from 'drizzle-orm/node-postgres';
import { shouldUseNeonHttp } from './neon-host';
import * as schema from './schema';

export { shouldUseNeonHttp } from './neon-host';

function connectNeonHttp(connectionString: string) {
  return drizzleNeonHttp(connectionString, { schema });
}

export type Database = ReturnType<typeof connectNeonHttp>;

function connect(connectionString: string): Database {
  // shouldUseNeonHttp is a total function (TRI-124: it returns false rather
  // than throwing for an unparseable string, since it is also exported as a
  // general-purpose predicate). This factory must still fail fast on a
  // malformed connection string rather than silently falling through to
  // node-postgres, which can interpret a malformed value using default
  // connection parameters and target an unintended host/database.
  if (!URL.canParse(connectionString)) {
    throw new Error(`Invalid database connection string: ${connectionString}`);
  }

  if (shouldUseNeonHttp(connectionString)) {
    return connectNeonHttp(connectionString);
  }

  return drizzleNodePostgres(connectionString, { schema }) as unknown as Database;
}

const databaseOverride = new AsyncLocalStorage<Database>();

/**
 * Run a callback with an overridden database instance.
 * Used by E2E tests to route queries to per-worker PGlite instances.
 */
export function runWithDatabase<T>(database: Database, callback: () => T): T {
  return databaseOverride.run(database, callback);
}

/**
 * Create a database connection.
 *
 * - String: creates a connection immediately.
 * - Function: defers connection until first query. Safe for module-level
 *   `export const db = createDatabase(...)` where the URL may not be
 *   available at import time (e.g., unit tests that never touch the DB).
 *
 * Lazy instances also check for an AsyncLocalStorage override set by
 * `runWithDatabase`, allowing E2E tests to swap in PGlite per request.
 */
export function createDatabase(connectionString: string | (() => string)): Database {
  if (typeof connectionString === 'string') {
    return connect(connectionString);
  }

  let cached: Database | null = null;
  return new Proxy({} as Database, {
    get(_target, property) {
      const active = databaseOverride.getStore() ?? (cached ??= connect(connectionString()));
      const value = Reflect.get(
        active as unknown as Record<PropertyKey, unknown>,
        property,
      ) as unknown;

      if (typeof value === 'function') {
        return (value as (...args: unknown[]) => unknown).bind(active);
      }

      return value;
    },
  });
}
