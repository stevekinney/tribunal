#!/usr/bin/env bun
/// <reference types="bun-types" />

/**
 * One-time cleanup script to remove pull_request_state rows for repositories
 * that are not linked to any Tribunal project (no row in project_repository).
 *
 * Cascading deletes handle pull_request_action_item, sources, and dependencies
 * automatically via ON DELETE CASCADE.
 *
 * Usage: bun run scripts/cleanup-unlinked-pull-request-data.ts [--dry-run]
 */

import { resolve } from 'node:path';
import { loadEnv } from './lib/load-env';

const repoRoot = resolve(import.meta.dir, '..');
loadEnv(repoRoot);

const { createDatabase } = await import('@tribunal/database').catch(async () => {
  return import('../packages/database/src/index.ts');
});
const { sql } = await import('@tribunal/database/operators').catch(async () => {
  return import('../packages/database/src/operators.ts');
});

const dryRun = process.argv.includes('--dry-run');

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const db = createDatabase(databaseUrl);

async function run(): Promise<void> {
  // Count affected rows before deletion
  const countResult = await db.execute(sql`
    SELECT COUNT(*) AS count
    FROM pull_request_state prs
    WHERE NOT EXISTS (
      SELECT 1 FROM project_repository pr
      WHERE pr.repository_id = prs.repository_id
    )
  `);

  const affectedCount = Number(countResult.rows[0]?.count ?? 0);

  if (affectedCount === 0) {
    console.log('No unlinked pull_request_state rows found. Nothing to clean up.');
    return;
  }

  // List affected repository IDs for audit
  const repositoryResult = await db.execute(sql`
    SELECT DISTINCT prs.repository_id
    FROM pull_request_state prs
    WHERE NOT EXISTS (
      SELECT 1 FROM project_repository pr
      WHERE pr.repository_id = prs.repository_id
    )
    ORDER BY prs.repository_id
  `);

  const affectedRepositoryIds = repositoryResult.rows.map((r) => r.repository_id);

  console.log(
    `Found ${affectedCount} pull_request_state rows for ${affectedRepositoryIds.length} unlinked repositories`,
  );
  console.log('Affected repository IDs:', affectedRepositoryIds);

  if (dryRun) {
    console.log('[dry-run] No rows deleted. Run without --dry-run to execute.');
    return;
  }

  // Delete unlinked rows (cascading deletes handle action items)
  const deleteResult = await db.execute(sql`
    DELETE FROM pull_request_state
    WHERE NOT EXISTS (
      SELECT 1 FROM project_repository pr
      WHERE pr.repository_id = pull_request_state.repository_id
    )
  `);

  console.log(
    `Deleted ${deleteResult.rowCount} pull_request_state rows (cascading to action items, sources, and dependencies)`,
  );
}

run().catch((error) => {
  console.error('Cleanup failed:', error);
  process.exit(1);
});
