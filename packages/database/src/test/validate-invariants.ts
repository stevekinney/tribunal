#!/usr/bin/env bun
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { getTableName, isTable, sql as rawSql } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import * as schema from '../schema';

/**
 * Severity level for invariant violations
 */
export type Severity = 'error' | 'warning';

/**
 * Result of a single invariant check
 */
export interface InvariantCheckResult {
  name: string;
  passed: boolean;
  severity: Severity;
  errorMessage?: string;
  details?: Record<string, unknown>;
}

/**
 * Overall validation result
 */
export interface ValidationResult {
  passed: boolean;
  checks: InvariantCheckResult[];
  errors: InvariantCheckResult[];
  warnings: InvariantCheckResult[];
}

/**
 * Invariant check definition
 */
export interface InvariantCheck {
  name: string;
  severity: Severity;
  errorMessage: string;
  query: string;
  validate: (rows: unknown[]) => boolean;
}

/**
 * All schema tables that must exist in the database.
 * Built from Drizzle table exports in src/schema/index.ts.
 * Sorted with deterministic comparisons for stable output across environments.
 */
const schemaTables = Object.values(schema).filter((value) => isTable(value)) as PgTable[];

export const EXPECTED_TABLES = Array.from(
  new Set(schemaTables.map((table) => getTableName(table))),
).sort((left, right) => {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
});

/**
 * Critical invariant checks for schema validation
 */
export const invariantChecks: InvariantCheck[] = [
  // 1. All schema tables exist in database
  {
    name: 'all_schema_tables_exist',
    severity: 'error',
    errorMessage: 'Some schema tables are missing from the database',
    query: `
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
    `,
    validate: (rows) => {
      const existingTables = new Set(rows.map((row: any) => row.table_name));
      const missingTables = EXPECTED_TABLES.filter((table) => !existingTables.has(table));

      if (missingTables.length > 0) {
        console.error('Missing tables:', missingTables);
        return false;
      }

      return true;
    },
  },

  // 2. All foreign key columns have indexes (project convention)
  {
    name: 'foreign_keys_have_indexes',
    severity: 'error',
    errorMessage: 'Some foreign key columns are missing indexes',
    query: `
      WITH fk_columns AS (
        SELECT
          tc.table_name,
          kcu.column_name,
          tc.constraint_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
        WHERE tc.constraint_type = 'FOREIGN KEY'
          AND tc.table_schema = 'public'
      ),
      indexed_columns AS (
        SELECT
          t.relname AS table_name,
          a.attname AS column_name
        FROM pg_class t
        JOIN pg_index ix ON t.oid = ix.indrelid
        JOIN pg_class i ON i.oid = ix.indexrelid
        JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public'
      )
      SELECT
        fk.table_name,
        fk.column_name,
        fk.constraint_name
      FROM fk_columns fk
      LEFT JOIN indexed_columns idx
        ON fk.table_name = idx.table_name
        AND fk.column_name = idx.column_name
      WHERE idx.column_name IS NULL
      ORDER BY fk.table_name, fk.column_name
    `,
    validate: (rows) => {
      if (rows.length > 0) {
        console.error('Foreign key columns without indexes:');
        rows.forEach((row: any) => {
          console.error(`  ${row.table_name}.${row.column_name} (${row.constraint_name})`);
        });
        return false;
      }
      return true;
    },
  },

  // 3. Migration count > 0 in drizzle.__drizzle_migrations table
  {
    name: 'migrations_table_populated',
    severity: 'error',
    errorMessage: 'No migrations found in drizzle.__drizzle_migrations table',
    query: `
      SELECT COUNT(*) as count
      FROM drizzle.__drizzle_migrations
    `,
    validate: (rows) => {
      const count = (rows[0] as any)?.count;
      if (!count || Number(count) === 0) {
        console.error('No migrations found in drizzle.__drizzle_migrations table');
        return false;
      }
      return true;
    },
  },

  // 4. Timestamp columns use timestamp with time zone
  {
    name: 'timestamps_have_timezone',
    severity: 'error',
    errorMessage: 'Some timestamp columns are missing timezone information',
    query: `
      SELECT
        table_name,
        column_name,
        data_type
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND data_type = 'timestamp without time zone'
        AND column_name IN ('created_at', 'updated_at', 'started_at', 'completed_at', 'delivered_at', 'next_attempt_at', 'expires_at')
      ORDER BY table_name, column_name
    `,
    validate: (rows) => {
      // For newer tables, this should be empty. Older tables are grandfathered.
      // We check newer tables specifically (those with withTimezone: true in schema)
      const newTablesWithoutTimezone = rows.filter((row: any) =>
        [
          'pull_request_action_item',
          'pull_request_action_item_source',
          'github_webhook_delivery',
          'linear_webhook_delivery',
        ].includes(row.table_name),
      );

      if (newTablesWithoutTimezone.length > 0) {
        console.error('New tables with timestamp columns missing timezone:');
        newTablesWithoutTimezone.forEach((row: any) => {
          console.error(`  ${row.table_name}.${row.column_name}`);
        });
        return false;
      }

      return true;
    },
  },

  // 5. ID and timestamp columns are NOT NULL
  {
    name: 'required_columns_not_null',
    severity: 'error',
    errorMessage: 'Some ID or timestamp columns allow NULL values',
    query: `
      SELECT
        table_name,
        column_name,
        is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND (
          (column_name = 'id' AND is_nullable = 'YES')
          OR (column_name = 'created_at' AND is_nullable = 'YES')
          OR (column_name = 'updated_at' AND is_nullable = 'YES')
        )
      ORDER BY table_name, column_name
    `,
    validate: (rows) => {
      if (rows.length > 0) {
        console.error('Columns that should be NOT NULL but allow nulls:');
        rows.forEach((row: any) => {
          console.error(`  ${row.table_name}.${row.column_name}`);
        });
        return false;
      }
      return true;
    },
  },

  // 6. UNIQUE constraints exist where expected
  {
    name: 'unique_constraints_exist',
    severity: 'error',
    errorMessage: 'Expected unique constraints are missing',
    query: `
      WITH expected_uniques AS (
        SELECT 'workflow_run' AS table_name, 'workflow_id' AS column_name
        UNION ALL
        SELECT 'pull_request_state', 'repository_id' -- part of composite unique (repository_id, pr_number)
        UNION ALL
        SELECT 'pull_request_action_item', 'pull_request_state_id' -- part of composite unique (pull_request_state_id, stable_key)
      ),
      actual_uniques AS (
        SELECT
          tc.table_name,
          kcu.column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
        WHERE tc.constraint_type = 'UNIQUE'
          AND tc.table_schema = 'public'
        UNION
        SELECT
          t.relname AS table_name,
          a.attname AS column_name
        FROM pg_class t
        JOIN pg_index ix ON t.oid = ix.indrelid
        JOIN pg_class i ON i.oid = ix.indexrelid
        JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE ix.indisunique = true
          AND n.nspname = 'public'
      )
      SELECT
        e.table_name,
        e.column_name
      FROM expected_uniques e
      LEFT JOIN actual_uniques a
        ON e.table_name = a.table_name
        AND e.column_name = a.column_name
      WHERE a.column_name IS NULL
    `,
    validate: (rows) => {
      if (rows.length > 0) {
        console.error('Expected unique constraints missing:');
        rows.forEach((row: any) => {
          console.error(`  ${row.table_name}.${row.column_name}`);
        });
        return false;
      }
      return true;
    },
  },

  // 7. Text over varchar preference (warning level)
  {
    name: 'prefer_text_over_varchar',
    severity: 'warning',
    errorMessage: 'Some columns use varchar instead of text',
    query: `
      SELECT
        table_name,
        column_name,
        data_type,
        character_maximum_length
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND data_type = 'character varying'
      ORDER BY table_name, column_name
    `,
    validate: (rows) => {
      if (rows.length > 0) {
        console.warn('Columns using varchar (consider using text):');
        rows.forEach((row: any) => {
          console.warn(
            `  ${row.table_name}.${row.column_name} (varchar(${row.character_maximum_length}))`,
          );
        });
        return false; // Return false to mark as warning
      }
      return true;
    },
  },
];

/**
 * Validate all database invariants
 *
 * @param connectionUri - Database connection URI
 * @returns ValidationResult with detailed check results
 *
 * @example
 * ```typescript
 * const result = await validateInvariants(process.env.DATABASE_URL);
 * if (!result.passed) {
 *   console.error('Validation failed:', result.errors);
 *   process.exit(1);
 * }
 * ```
 */
export async function validateInvariants(connectionUri: string): Promise<ValidationResult> {
  console.log('Running invariant checks...\n');

  const sqlClient = neon(connectionUri);
  const db = drizzle({ client: sqlClient });
  const checks: InvariantCheckResult[] = [];

  for (const check of invariantChecks) {
    console.log(`Running check: ${check.name}...`);

    try {
      const result = await db.execute(rawSql.raw(check.query));
      const rows = result.rows;
      const passed = check.validate(rows);

      checks.push({
        name: check.name,
        passed,
        severity: check.severity,
        errorMessage: passed ? undefined : check.errorMessage,
        details: passed ? undefined : { rowCount: rows.length },
      });

      if (passed) {
        console.log(`✓ ${check.name} passed`);
      } else {
        if (check.severity === 'error') {
          console.error(`✗ ${check.name} failed: ${check.errorMessage}`);
        } else {
          console.warn(`⚠ ${check.name} warning: ${check.errorMessage}`);
        }
      }
    } catch (error) {
      console.error(`✗ ${check.name} threw error:`, error);
      checks.push({
        name: check.name,
        passed: false,
        severity: check.severity,
        errorMessage: `Check threw error: ${error}`,
      });
    }

    console.log('');
  }

  const errors = checks.filter((c) => !c.passed && c.severity === 'error');
  const warnings = checks.filter((c) => !c.passed && c.severity === 'warning');
  const passed = errors.length === 0;

  const result: ValidationResult = {
    passed,
    checks,
    errors,
    warnings,
  };

  console.log('='.repeat(70));
  console.log('Validation Summary:');
  console.log('='.repeat(70));
  console.log(`Total checks: ${checks.length}`);
  console.log(`Passed: ${checks.filter((c) => c.passed).length}`);
  console.log(`Errors: ${errors.length}`);
  console.log(`Warnings: ${warnings.length}`);
  console.log(`Overall: ${passed ? '✓ PASSED' : '✗ FAILED'}`);
  console.log('='.repeat(70));

  return result;
}

/**
 * CLI execution mode
 */
if (import.meta.main) {
  const connectionUri = process.env.DATABASE_URL;
  if (!connectionUri) {
    console.error('DATABASE_URL environment variable is required');
    process.exit(1);
  }

  const result = await validateInvariants(connectionUri);

  if (!result.passed) {
    console.error('\n::error::Database validation failed');
    result.errors.forEach((error) => {
      console.error(`::error::${error.name}: ${error.errorMessage}`);
    });
    process.exit(1);
  }

  if (result.warnings.length > 0) {
    console.warn('\nWarnings were found but validation passed:');
    result.warnings.forEach((warning) => {
      console.warn(`::warning::${warning.name}: ${warning.errorMessage}`);
    });
  }

  process.exit(0);
}
