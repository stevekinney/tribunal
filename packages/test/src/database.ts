/**
 * Test database utilities using PGlite (in-memory PostgreSQL)
 *
 * Usage in tests:
 * ```ts
 * import { createTestDatabase, type TestDatabase } from '@tribunal/test/database';
 *
 * describe('my feature', () => {
 *   let testDb: TestDatabase;
 *
 *   beforeAll(async () => {
 *     testDb = await createTestDatabase();
 *   });
 *
 *   afterAll(async () => {
 *     await testDb.close();
 *   });
 *
 *   beforeEach(async () => {
 *     await testDb.reset();
 *   });
 *
 *   it('works', async () => {
 *     const { db } = testDb;
 *     // Use db as normal drizzle instance
 *   });
 * });
 * ```
 */
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import type * as schema from '@tribunal/database/schema';
import * as schemaModule from '@tribunal/database/schema';

export type TestDatabase = {
  /** The Drizzle database instance */
  db: PgliteDatabase<typeof schema>;
  /** The underlying PGlite instance */
  client: PGlite;
  /** Reset all tables (truncate with cascade) */
  reset: () => Promise<void>;
  /** Close the database connection */
  close: () => Promise<void>;
};

/**
 * Reads pre-generated migration SQL from @tribunal/database/drizzle/.
 *
 * This avoids the expensive runtime `import('drizzle-kit/api')` + schema
 * introspection that was previously used. Migration files are read once per
 * worker and cached at module level.
 */
let cachedMigrationSQL: string | null = null;

function loadMigrationSQL(): string {
  if (cachedMigrationSQL !== null) return cachedMigrationSQL;

  const require = createRequire(import.meta.url);
  const schemaEntrypoint = require.resolve('@tribunal/database/schema');
  // schemaEntrypoint is .../packages/database/src/schema/index.ts
  const databasePackageRoot = dirname(dirname(dirname(schemaEntrypoint)));
  const migrationsDirectory = join(databasePackageRoot, 'drizzle');

  const sqlFiles = readdirSync(migrationsDirectory)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  const statements = sqlFiles.map((file) => {
    const sql = readFileSync(join(migrationsDirectory, file), 'utf-8');
    return sql.replaceAll('--> statement-breakpoint', '');
  });

  cachedMigrationSQL = statements.join('\n');
  return cachedMigrationSQL;
}

async function applyTestSchema(client: PGlite) {
  const sql = loadMigrationSQL();
  if (sql.length === 0) return;
  await client.exec(sql);
}

/**
 * Creates an in-memory PostgreSQL database for testing.
 *
 * Each call creates a completely isolated database instance.
 * Use `reset()` between tests to clear all data while preserving the schema.
 *
 * Schema is applied by reading pre-generated migration SQL files from
 * `@tribunal/database/drizzle/`. Run `bun run db:generate` after schema changes
 * to keep migrations in sync.
 */
export async function createTestDatabase(): Promise<TestDatabase> {
  const initStart = performance.now();

  // PGlite's WASM cold-start is async: the constructor returns synchronously
  // but the engine is not ready until `waitReady` resolves. Await it before
  // applying the schema so the two elapsed times measure separate phases.
  const wasmStart = performance.now();
  const client = new PGlite();
  await client.waitReady;
  const wasmElapsed = performance.now() - wasmStart;

  const db = drizzle(client, { schema: schemaModule });

  const schemaStart = performance.now();
  await applyTestSchema(client);
  const schemaElapsed = performance.now() - schemaStart;

  const totalElapsed = performance.now() - initStart;

  // Warn only on genuinely abnormal runs. PGlite cold-start typically takes
  // 8–15s; a 20s threshold fires only when something is actually wrong, rather
  // than on every healthy CI run. The hookTimeout budget is 30s.
  if (totalElapsed > 20_000) {
    console.warn(
      `[tribunal-test:database] Slow PGlite init: ${totalElapsed.toFixed(0)}ms ` +
        `(WASM: ${wasmElapsed.toFixed(0)}ms, schema: ${schemaElapsed.toFixed(0)}ms)`,
    );
  }

  const reset = async () => {
    const results = await client.exec(
      "SELECT quote_ident(tablename) AS name FROM pg_tables WHERE schemaname = 'public'",
    );
    type TableRow = { name: string };
    const tables = (results[0]?.rows as TableRow[] | undefined)?.map((row) => row.name) ?? [];
    // Filter out Drizzle's internal migrations table. Note: quote_ident only adds quotes
    // for identifiers that need escaping, so we check both quoted and unquoted forms.
    const userTables = tables.filter(
      (name) => name !== '__drizzle_migrations' && name !== '"__drizzle_migrations"',
    );

    if (userTables.length > 0) {
      await client.exec(`TRUNCATE TABLE ${userTables.join(', ')} RESTART IDENTITY CASCADE`);
    }
  };

  const close = async () => {
    await client.close();
  };

  return { db, client, reset, close };
}
