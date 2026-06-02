#!/usr/bin/env bun
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { sql as rawSql } from 'drizzle-orm';
import { EXPECTED_TABLES } from './validate-invariants';

/**
 * Drift detection types
 */
export type DriftType = 'MISSING_TABLE' | 'EXTRA_TABLE' | 'COLUMN_MISMATCH' | 'CONSTRAINT_MISSING';

export type DriftSeverity = 'critical' | 'warning';

export interface DriftDetail {
  type: DriftType;
  severity: DriftSeverity;
  message: string;
}

export interface DriftReport {
  hasDrift: boolean;
  hasCriticalDrift: boolean;
  criticalCount: number;
  warningCount: number;
  summary: string;
  details: DriftDetail[];
  timestamp: string;
  environment: string;
}

/**
 * Detect drift between schema definition and actual database state
 *
 * @param connectionUri - Database connection URI
 * @returns DriftReport with detailed findings
 */
export async function detectDrift(connectionUri: string): Promise<DriftReport> {
  console.log('Starting drift detection...\n');

  const sqlClient = neon(connectionUri);
  const db = drizzle({ client: sqlClient });
  const details: DriftDetail[] = [];

  // Check 1: Compare schema tables with database tables
  console.log('Step 1: Checking for missing and extra tables...');

  const tableQuery = `
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
  `;

  const result = await db.execute(rawSql.raw(tableQuery));
  const existingTables = new Set(result.rows.map((row: any) => row.table_name));

  // Check for missing tables (defined in schema but not in database)
  const missingTables = EXPECTED_TABLES.filter((table) => !existingTables.has(table));
  missingTables.forEach((table) => {
    details.push({
      type: 'MISSING_TABLE',
      severity: 'critical',
      message: `Table '${table}' is defined in schema but missing from database`,
    });
  });

  // Check for extra tables (in database but not in schema)
  const extraTables = Array.from(existingTables).filter(
    (table) => !EXPECTED_TABLES.includes(table),
  );
  extraTables.forEach((table) => {
    details.push({
      type: 'EXTRA_TABLE',
      severity: 'warning',
      message: `Table '${table}' exists in database but not defined in schema`,
    });
  });

  console.log(`  Missing tables: ${missingTables.length}`);
  console.log(`  Extra tables: ${extraTables.length}`);

  // Check 2: Verify tables have columns
  console.log('\nStep 2: Checking tables have columns...');

  // Build the query with table names directly in the SQL
  const tableNames = EXPECTED_TABLES.map((t) => `'${t}'`).join(', ');
  const columnQuery = `
    SELECT DISTINCT table_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name IN (${tableNames})
  `;

  const columnResult = await db.execute(rawSql.raw(columnQuery));
  const tablesWithColumns = new Set(columnResult.rows.map((row: any) => row.table_name));

  // Check for tables with no columns (should not happen unless table was just created)
  EXPECTED_TABLES.forEach((table) => {
    if (existingTables.has(table) && !tablesWithColumns.has(table)) {
      details.push({
        type: 'COLUMN_MISMATCH',
        severity: 'critical',
        message: `Table '${table}' exists but has no columns`,
      });
    }
  });

  console.log(`  Tables checked: ${tablesWithColumns.size}`);

  // Check 3: Verify critical constraints exist
  console.log('\nStep 3: Checking constraints...');

  const constraintQuery = `
    SELECT
      tc.table_name,
      tc.constraint_name,
      tc.constraint_type,
      kcu.column_name
    FROM information_schema.table_constraints tc
    LEFT JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    WHERE tc.table_schema = 'public'
      AND tc.table_name IN (${tableNames})
    ORDER BY tc.table_name, tc.constraint_type, tc.constraint_name
  `;

  const constraintResult = await db.execute(rawSql.raw(constraintQuery));
  const constraintsByTable = new Map<string, any[]>();

  constraintResult.rows.forEach((row: any) => {
    if (!constraintsByTable.has(row.table_name)) {
      constraintsByTable.set(row.table_name, []);
    }
    constraintsByTable.get(row.table_name)!.push(row);
  });

  // Check that each schema table has a primary key
  EXPECTED_TABLES.forEach((table) => {
    if (!existingTables.has(table)) {
      return; // Already flagged as missing
    }

    const constraints = constraintsByTable.get(table) || [];
    const hasPrimaryKey = constraints.some((c) => c.constraint_type === 'PRIMARY KEY');

    if (!hasPrimaryKey) {
      details.push({
        type: 'CONSTRAINT_MISSING',
        severity: 'critical',
        message: `Table '${table}' is missing PRIMARY KEY constraint`,
      });
    }
  });

  console.log(`  Constraints checked across ${constraintsByTable.size} tables`);

  // Generate summary
  const criticalCount = details.filter((d) => d.severity === 'critical').length;
  const warningCount = details.filter((d) => d.severity === 'warning').length;

  const hasDrift = details.length > 0;
  const hasCriticalDrift = criticalCount > 0;
  let summary: string;

  if (!hasDrift) {
    summary = 'No drift detected - schema and database are in sync';
  } else {
    summary = `Drift detected: ${criticalCount} critical issue(s), ${warningCount} warning(s)`;
  }

  const report: DriftReport = {
    hasDrift,
    hasCriticalDrift,
    criticalCount,
    warningCount,
    summary,
    details,
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'unknown',
  };

  console.log('\n' + '='.repeat(70));
  console.log('Drift Detection Summary');
  console.log('='.repeat(70));
  let status = '✓ NO DRIFT';
  if (hasCriticalDrift) {
    status = '✗ CRITICAL DRIFT DETECTED';
  } else if (hasDrift) {
    status = '⚠ WARNING-ONLY DRIFT DETECTED';
  }
  console.log(`Status: ${status}`);
  console.log(`Critical issues: ${criticalCount}`);
  console.log(`Warnings: ${warningCount}`);
  console.log('='.repeat(70));

  if (hasDrift) {
    console.log('\nDrift details:');
    details.forEach((detail, index) => {
      const icon = detail.severity === 'critical' ? '✗' : '⚠';
      console.log(`${index + 1}. [${detail.severity.toUpperCase()}] ${icon} ${detail.message}`);
    });
  }

  return report;
}

/**
 * Write drift report to test-results directory
 */
async function writeDriftReport(report: DriftReport): Promise<void> {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const resultsDir = resolve(currentDir, '../../test-results');

  await mkdir(resultsDir, { recursive: true });

  const reportPath = resolve(resultsDir, 'drift-report.json');
  await writeFile(reportPath, JSON.stringify(report, null, 2));

  console.log(`\nDrift report written to: ${reportPath}`);
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

  try {
    const report = await detectDrift(connectionUri);
    await writeDriftReport(report);

    if (report.hasDrift) {
      if (report.hasCriticalDrift) {
        console.error('\n::error::Critical database drift detected');
        report.details
          .filter((d) => d.severity === 'critical')
          .forEach((detail) => {
            console.error(`::error::${detail.type}: ${detail.message}`);
          });
        report.details
          .filter((d) => d.severity === 'warning')
          .forEach((detail) => {
            console.warn(`::warning::${detail.type}: ${detail.message}`);
          });
        process.exit(1);
      }

      console.warn('\n::warning::Database drift warnings detected');
      report.details
        .filter((d) => d.severity === 'warning')
        .forEach((detail) => {
          console.warn(`::warning::${detail.type}: ${detail.message}`);
        });
      console.log('\n✓ Drift detection completed with warnings only');
      process.exit(0);
    }

    console.log('\n✓ Drift detection completed successfully - no drift found');
    process.exit(0);
  } catch (error) {
    console.error('::error::Drift detection failed:', error);
    process.exit(1);
  }
}
