import { Pool as NeonPool } from '@neondatabase/serverless';
import { NeonHttpDatabase } from 'drizzle-orm/neon-http';
import { drizzle as drizzleNeonServerless } from 'drizzle-orm/neon-serverless';
import { drizzle as drizzleNodePostgres } from 'drizzle-orm/node-postgres';
import { Pool as NodePostgresPool } from 'pg';
import {
  createPostgresOAuthStores,
  type PostgresOAuthSchema,
} from '@lostgradient/mcp/oauth/postgres';
import type { OAuthStores } from '@lostgradient/mcp/oauth/stores';
import * as schema from '../schema';
import { oauthEngineSchema } from '../schema/oauth';

/**
 * The OAuth storage seam.
 *
 * Every OAuth query — client registration, code exchange, token mint, refresh
 * rotation, revocation, family revocation, and the transaction lifecycle —
 * lives in `@lostgradient/mcp`'s Postgres adapter. Tribunal writes none of it.
 * This module only constructs that adapter against Tribunal's schema
 * instantiation ([[oauth]] / `oauthEngineSchema`) and hands the resulting
 * stores to the mount.
 *
 * ## Why this seam does not reuse `db`
 *
 * The adapter requires an **interactive-transaction** driver. Its four
 * TokenStore mutations — `rotateRefreshToken`, `revokeAccessToken`,
 * `revokeRefreshToken`, and `revokeFamily` — each open
 * `database.transaction(...)`, and `revokeFamily` holds a transaction-scoped
 * `pg_advisory_xact_lock` for concurrency correctness. Tribunal's main
 * connection (`connection.ts`) uses `drizzle-orm/neon-http`, whose
 * `.transaction()` throws `"No transactions support in neon-http driver"`
 * unconditionally. Wiring the adapter to that connection would throw in
 * production on token rotation and every revocation path, while a
 * transaction-capable test driver (PGlite) would pass and hide it.
 *
 * So the seam builds its own transaction-capable connection: the
 * `@neondatabase/serverless` WebSocket `Pool` via `drizzle-orm/neon-serverless`
 * for Neon hosts, and `node-postgres` for a local or direct Postgres. Both
 * support `.transaction()`; `neon-http` is never selected here, by
 * construction. The WebSocket driver requires a long-lived process, which the
 * MCP mount already mandates (`@sveltejs/adapter-node`). Decided in TRI-35.
 */

/**
 * A live OAuth storage seam: the library's stores plus the `dispose` that
 * closes the connection pool backing them. The mount owns the single instance
 * and calls `dispose` on shutdown (TRI-51).
 */
export type OAuthStorageSeam = {
  stores: OAuthStores;
  /** The transaction-capable connection backing the stores (for health probes). */
  database: OAuthDatabase;
  dispose: () => Promise<void>;
};

/** The database surface the library's adapter consumes (`{ execute, transaction }`). */
export type OAuthDatabase = Parameters<typeof createPostgresOAuthStores>[0];

function isNeonHost(connectionString: string): boolean {
  const { hostname } = new URL(connectionString);
  return hostname.endsWith('.neon.tech') || hostname.endsWith('.neon.build');
}

/**
 * Builds the stores against a database the caller already holds. Tests inject
 * PGlite here; it is also the single place the adapter is constructed against
 * Tribunal's schema, so the two connection-backed paths below both route
 * through it.
 */
export function createOAuthStores(database: OAuthDatabase): OAuthStores {
  // Enforce the driver requirement at construction rather than letting a token
  // mutation throw in production. A `neon-http` instance has no working
  // `.transaction()`, so refuse it here with an actionable message. (This
  // catches a real neon-http instance; the lazy `Proxy` that `createDatabase`
  // returns for a thunk is a `Proxy` over `{}` and is not caught by
  // `instanceof` — callers should use `createOAuthStorageSeam` rather than
  // hand-injecting `db`.)
  if (database instanceof NeonHttpDatabase) {
    throw new Error(
      'The OAuth storage seam requires an interactive-transaction driver; the ' +
        'neon-http driver has none. Use createOAuthStorageSeam, which selects ' +
        'neon-serverless or node-postgres.',
    );
  }
  // `PostgresOAuthSchema` is `ReturnType<typeof createPostgresOAuthSchema>` with
  // the generic user-id column collapsed to its base, which drizzle types as
  // `notNull: false`. Tribunal's instantiation makes `user_id` `notNull: true`
  // (correct — every OAuth row belongs to a user), and drizzle's column phantom
  // types are invariant, so the stricter column is not structurally assignable
  // to the looser one. The mismatch is purely at the type level: the stores
  // only read and write these tables, which `oauth.test.ts` exercises end to
  // end. The cast bridges the library's over-constrained parameter type.
  return createPostgresOAuthStores(database, oauthEngineSchema as unknown as PostgresOAuthSchema);
}

/**
 * Constructs the OAuth seam from a connection string, selecting a
 * transaction-capable driver by host. Never selects `neon-http` (see the
 * module comment). The pool connects lazily, so construction does no I/O.
 */
export function createOAuthStorageSeam(connectionString: string): OAuthStorageSeam {
  if (isNeonHost(connectionString)) {
    const pool = new NeonPool({ connectionString });
    const database = drizzleNeonServerless(pool, { schema });
    return { stores: createOAuthStores(database), database, dispose: () => pool.end() };
  }

  const pool = new NodePostgresPool({ connectionString });
  const database = drizzleNodePostgres(pool, { schema });
  return { stores: createOAuthStores(database), database, dispose: () => pool.end() };
}
