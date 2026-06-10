/**
 * Configuration for the in-process Weft engine.
 *
 * IMPORTANT — storage isolation: Weft's `NeonStorage` creates and owns a single
 * `kv` table (key TEXT COLLATE "C", value BYTEA) in whatever database its
 * connection string points at. It MUST NOT share a database (or schema) with
 * Tribunal's Drizzle-managed tables:
 *
 *   1. Tribunal's drift detection (`db:detect-drift`, `validate-invariants`)
 *      would flag the unmanaged `kv` table and fail CI.
 *   2. A `drizzle-kit push` could drop `kv` — destroying live workflow state.
 *
 * So the engine reads a dedicated `WEFT_DATABASE_URL` (a separate Neon
 * branch/database), never `DATABASE_URL`. The `kv` table's `key` column must use
 * `COLLATE "C"` or NeonStorage throws at boot — point this URL at a fresh
 * database and let NeonStorage create the table.
 */
import { env } from '$env/dynamic/private';

export type WeftConfiguration = {
  /** Dedicated Postgres/Neon URL for Weft durable storage. Separate from DATABASE_URL. */
  databaseUrl: string | undefined;
  isProduction: boolean;
};

/** Resolve the Weft engine configuration from SvelteKit's private env. */
export function getWeftConfiguration(): WeftConfiguration {
  return {
    databaseUrl: env.WEFT_DATABASE_URL || undefined,
    isProduction: env.NODE_ENV === 'production',
  };
}
