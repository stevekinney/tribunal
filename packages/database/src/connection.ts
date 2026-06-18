import { AsyncLocalStorage } from 'node:async_hooks';
import { drizzle as drizzleNeonHttp } from 'drizzle-orm/neon-http';
import { drizzle as drizzleNodePostgres } from 'drizzle-orm/node-postgres';
import * as schema from './schema';

function connectNeonHttp(connectionString: string) {
  return drizzleNeonHttp(connectionString, { schema });
}

export type Database = ReturnType<typeof connectNeonHttp>;

function connect(connectionString: string): Database {
  if (shouldUseNeonHttp(connectionString)) {
    return connectNeonHttp(connectionString);
  }

  return drizzleNodePostgres(connectionString, { schema }) as unknown as Database;
}

function shouldUseNeonHttp(connectionString: string): boolean {
  const parsed = new URL(connectionString);
  return parsed.hostname.endsWith('.neon.tech') || parsed.hostname.endsWith('.neon.build');
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
