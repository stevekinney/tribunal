import { describe, it, expect } from 'vitest';
import { EXPECTED_TABLES } from '../validate-invariants';
import type { DriftDetail, DriftReport } from '../detect-drift';

/**
 * These tests validate the drift detection logic by simulating database
 * responses. Since detectDrift() creates a real Neon connection, we
 * replicate its detection algorithm with the same logic applied to
 * mock data, verifying the behavior patterns that detectDrift implements.
 *
 * The core algorithm for each drift type is extracted and tested directly.
 */

/**
 * Reproduce the MISSING_TABLE detection logic from detect-drift.ts.
 * Compares EXPECTED_TABLES against a set of existing table names.
 */
function detectMissingTables(existingTables: Set<string>): DriftDetail[] {
  const details: DriftDetail[] = [];
  const missingTables = EXPECTED_TABLES.filter((table) => !existingTables.has(table));
  for (const table of missingTables) {
    details.push({
      type: 'MISSING_TABLE',
      severity: 'critical',
      message: `Table '${table}' is defined in schema but missing from database`,
    });
  }
  return details;
}

/**
 * Reproduce the EXTRA_TABLE detection logic from detect-drift.ts.
 * Finds tables in the database that are not in the expected schema.
 */
function detectExtraTables(existingTables: Set<string>): DriftDetail[] {
  const details: DriftDetail[] = [];
  const extraTables = Array.from(existingTables).filter(
    (table) => !EXPECTED_TABLES.includes(table),
  );
  for (const table of extraTables) {
    details.push({
      type: 'EXTRA_TABLE',
      severity: 'warning',
      message: `Table '${table}' exists in database but not defined in schema`,
    });
  }
  return details;
}

/**
 * Reproduce the COLUMN_MISMATCH detection for tables with no columns.
 */
function detectEmptyColumnTables(
  existingTables: Set<string>,
  tablesWithColumns: Set<string>,
): DriftDetail[] {
  const details: DriftDetail[] = [];
  for (const table of EXPECTED_TABLES) {
    if (existingTables.has(table) && !tablesWithColumns.has(table)) {
      details.push({
        type: 'COLUMN_MISMATCH',
        severity: 'critical',
        message: `Table '${table}' exists but has no columns`,
      });
    }
  }
  return details;
}

/**
 * Reproduce the CONSTRAINT_MISSING detection for tables without a primary key.
 */
function detectMissingPrimaryKeys(
  existingTables: Set<string>,
  tablesWithPrimaryKey: Set<string>,
): DriftDetail[] {
  const details: DriftDetail[] = [];
  for (const table of EXPECTED_TABLES) {
    if (!existingTables.has(table)) {
      continue; // Already flagged as missing table
    }
    if (!tablesWithPrimaryKey.has(table)) {
      details.push({
        type: 'CONSTRAINT_MISSING',
        severity: 'critical',
        message: `Table '${table}' is missing PRIMARY KEY constraint`,
      });
    }
  }
  return details;
}

function expectedTablesForScenario(count: number): string[] {
  const tableNames = EXPECTED_TABLES.slice(0, count);

  if (tableNames.length !== count) {
    throw new Error(`Expected at least ${count} schema table(s) for migration scenario tests`);
  }

  return tableNames;
}

/**
 * Build a complete drift report from the individual detection functions.
 */
function buildDriftReport(
  existingTables: Set<string>,
  tablesWithColumns: Set<string>,
  tablesWithPrimaryKey: Set<string>,
): DriftReport {
  const details: DriftDetail[] = [
    ...detectMissingTables(existingTables),
    ...detectExtraTables(existingTables),
    ...detectEmptyColumnTables(existingTables, tablesWithColumns),
    ...detectMissingPrimaryKeys(existingTables, tablesWithPrimaryKey),
  ];

  const criticalCount = details.filter((d) => d.severity === 'critical').length;
  const warningCount = details.filter((d) => d.severity === 'warning').length;
  const hasDrift = details.length > 0;
  const hasCriticalDrift = criticalCount > 0;

  return {
    hasDrift,
    hasCriticalDrift,
    criticalCount,
    warningCount,
    summary: hasDrift
      ? `Drift detected: ${criticalCount} critical issue(s), ${warningCount} warning(s)`
      : 'No drift detected - schema and database are in sync',
    details,
    timestamp: new Date().toISOString(),
    environment: 'test',
  };
}

describe('drift detection logic', () => {
  describe('MISSING_TABLE detection', () => {
    it('produces no drift when all expected tables exist', () => {
      const existingTables = new Set(EXPECTED_TABLES);
      const details = detectMissingTables(existingTables);

      expect(details).toHaveLength(0);
    });

    it('flags a single missing table as critical', () => {
      const allExceptFirst = EXPECTED_TABLES.slice(1);
      const existingTables = new Set(allExceptFirst);
      const details = detectMissingTables(existingTables);

      expect(details).toHaveLength(1);
      expect(details[0].type).toBe('MISSING_TABLE');
      expect(details[0].severity).toBe('critical');
      expect(details[0].message).toContain(EXPECTED_TABLES[0]);
    });

    it('flags multiple missing tables', () => {
      const partialTables = EXPECTED_TABLES.slice(5);
      const existingTables = new Set(partialTables);
      const details = detectMissingTables(existingTables);

      expect(details).toHaveLength(5);
      for (const detail of details) {
        expect(detail.type).toBe('MISSING_TABLE');
        expect(detail.severity).toBe('critical');
      }
    });

    it('flags all tables when database is empty', () => {
      const existingTables = new Set<string>();
      const details = detectMissingTables(existingTables);

      expect(details).toHaveLength(EXPECTED_TABLES.length);
    });
  });

  describe('EXTRA_TABLE detection', () => {
    it('produces no drift when database has only expected tables', () => {
      const existingTables = new Set(EXPECTED_TABLES);
      const details = detectExtraTables(existingTables);

      expect(details).toHaveLength(0);
    });

    it('flags extra tables as warning severity', () => {
      const existingTables = new Set([...EXPECTED_TABLES, 'legacy_audit_log']);
      const details = detectExtraTables(existingTables);

      expect(details).toHaveLength(1);
      expect(details[0].type).toBe('EXTRA_TABLE');
      expect(details[0].severity).toBe('warning');
      expect(details[0].message).toContain('legacy_audit_log');
    });

    it('flags multiple extra tables', () => {
      const extraNames = ['_prisma_migrations', 'temp_data', 'backup_users'];
      const existingTables = new Set([...EXPECTED_TABLES, ...extraNames]);
      const details = detectExtraTables(existingTables);

      expect(details).toHaveLength(3);
      for (const detail of details) {
        expect(detail.type).toBe('EXTRA_TABLE');
        expect(detail.severity).toBe('warning');
      }
    });

    it('ignores expected tables and only reports extras', () => {
      const existingTables = new Set([...EXPECTED_TABLES, 'unknown_table']);
      const details = detectExtraTables(existingTables);

      expect(details).toHaveLength(1);
      expect(details[0].message).toContain('unknown_table');
    });
  });

  describe('COLUMN_MISMATCH detection (empty column tables)', () => {
    it('produces no drift when all tables have columns', () => {
      const existingTables = new Set(EXPECTED_TABLES);
      const tablesWithColumns = new Set(EXPECTED_TABLES);
      const details = detectEmptyColumnTables(existingTables, tablesWithColumns);

      expect(details).toHaveLength(0);
    });

    it('flags a table that exists but has no columns', () => {
      const existingTables = new Set(EXPECTED_TABLES);
      const tablesWithColumns = new Set(EXPECTED_TABLES.filter((t) => t !== 'user'));
      const details = detectEmptyColumnTables(existingTables, tablesWithColumns);

      expect(details).toHaveLength(1);
      expect(details[0].type).toBe('COLUMN_MISMATCH');
      expect(details[0].severity).toBe('critical');
      expect(details[0].message).toContain('user');
    });

    it('does not flag missing tables (those are handled separately)', () => {
      // "user" table is not in existingTables, so it should not be flagged as COLUMN_MISMATCH
      const existingTables = new Set(EXPECTED_TABLES.filter((t) => t !== 'user'));
      const tablesWithColumns = new Set(EXPECTED_TABLES.filter((t) => t !== 'user'));
      const details = detectEmptyColumnTables(existingTables, tablesWithColumns);

      expect(details).toHaveLength(0);
    });
  });

  describe('CONSTRAINT_MISSING detection (missing primary key)', () => {
    it('produces no drift when all tables have primary keys', () => {
      const existingTables = new Set(EXPECTED_TABLES);
      const tablesWithPrimaryKey = new Set(EXPECTED_TABLES);
      const details = detectMissingPrimaryKeys(existingTables, tablesWithPrimaryKey);

      expect(details).toHaveLength(0);
    });

    it('flags a table without a primary key as critical', () => {
      const [tableMissingPrimaryKey] = expectedTablesForScenario(1);
      const existingTables = new Set(EXPECTED_TABLES);
      const tablesWithPrimaryKey = new Set(
        EXPECTED_TABLES.filter((table) => table !== tableMissingPrimaryKey),
      );
      const details = detectMissingPrimaryKeys(existingTables, tablesWithPrimaryKey);

      expect(details).toHaveLength(1);
      expect(details[0].type).toBe('CONSTRAINT_MISSING');
      expect(details[0].severity).toBe('critical');
      expect(details[0].message).toContain(tableMissingPrimaryKey);
      expect(details[0].message).toContain('PRIMARY KEY');
    });

    it('skips missing tables (already flagged by MISSING_TABLE)', () => {
      const existingTables = new Set(EXPECTED_TABLES.filter((t) => t !== 'user'));
      const tablesWithPrimaryKey = new Set(EXPECTED_TABLES.filter((t) => t !== 'user'));
      const details = detectMissingPrimaryKeys(existingTables, tablesWithPrimaryKey);

      expect(details).toHaveLength(0);
    });

    it('flags multiple tables without primary keys', () => {
      const existingTables = new Set(EXPECTED_TABLES);
      const missingPrimaryKeyTables = expectedTablesForScenario(3);
      const tablesWithPrimaryKey = new Set(
        EXPECTED_TABLES.filter((table) => !missingPrimaryKeyTables.includes(table)),
      );
      const details = detectMissingPrimaryKeys(existingTables, tablesWithPrimaryKey);

      expect(details).toHaveLength(3);
      for (const detail of details) {
        expect(detail.type).toBe('CONSTRAINT_MISSING');
      }
    });
  });

  describe('complete drift report building', () => {
    it('produces a clean report when no drift exists', () => {
      const existingTables = new Set(EXPECTED_TABLES);
      const tablesWithColumns = new Set(EXPECTED_TABLES);
      const tablesWithPrimaryKey = new Set(EXPECTED_TABLES);

      const report = buildDriftReport(existingTables, tablesWithColumns, tablesWithPrimaryKey);

      expect(report.hasDrift).toBe(false);
      expect(report.hasCriticalDrift).toBe(false);
      expect(report.criticalCount).toBe(0);
      expect(report.warningCount).toBe(0);
      expect(report.details).toHaveLength(0);
      expect(report.summary).toContain('No drift detected');
    });

    it('combines missing table and extra table into one report', () => {
      const tablesMinusOne = EXPECTED_TABLES.slice(1);
      const existingTables = new Set([...tablesMinusOne, 'unknown_extra']);
      const tablesWithColumns = new Set(tablesMinusOne);
      const tablesWithPrimaryKey = new Set(tablesMinusOne);

      const report = buildDriftReport(existingTables, tablesWithColumns, tablesWithPrimaryKey);

      expect(report.hasDrift).toBe(true);
      expect(report.hasCriticalDrift).toBe(true);
      expect(report.details.length).toBeGreaterThanOrEqual(2);

      const types = new Set(report.details.map((d) => d.type));
      expect(types.has('MISSING_TABLE')).toBe(true);
      expect(types.has('EXTRA_TABLE')).toBe(true);
    });

    it('includes critical count and warning count in summary', () => {
      const [tableMissingPrimaryKey] = expectedTablesForScenario(1);
      const existingTables = new Set([...EXPECTED_TABLES, 'extra_table']);
      const tablesWithColumns = new Set(EXPECTED_TABLES);
      const tablesWithPrimaryKey = new Set(
        EXPECTED_TABLES.filter((table) => table !== tableMissingPrimaryKey),
      );

      const report = buildDriftReport(existingTables, tablesWithColumns, tablesWithPrimaryKey);

      expect(report.hasDrift).toBe(true);
      expect(report.hasCriticalDrift).toBe(true);
      expect(report.criticalCount).toBe(1);
      expect(report.warningCount).toBe(1);
      // 1 critical (missing PK on session) + 1 warning (extra_table)
      expect(report.summary).toContain('1 critical');
      expect(report.summary).toContain('1 warning');
    });

    it('classifies all MISSING_TABLE and CONSTRAINT_MISSING as critical', () => {
      const existingTables = new Set(EXPECTED_TABLES.slice(2));
      const tablesWithColumns = new Set(EXPECTED_TABLES.slice(2));
      const tablesWithPrimaryKey = new Set(EXPECTED_TABLES.slice(2));

      const report = buildDriftReport(existingTables, tablesWithColumns, tablesWithPrimaryKey);

      const criticalDetails = report.details.filter((d) => d.severity === 'critical');
      expect(criticalDetails.length).toBeGreaterThan(0);
      for (const detail of criticalDetails) {
        expect(['MISSING_TABLE', 'COLUMN_MISMATCH', 'CONSTRAINT_MISSING']).toContain(detail.type);
      }
    });

    it('classifies EXTRA_TABLE as warning', () => {
      const existingTables = new Set([...EXPECTED_TABLES, 'orphaned_table']);
      const tablesWithColumns = new Set(EXPECTED_TABLES);
      const tablesWithPrimaryKey = new Set(EXPECTED_TABLES);

      const report = buildDriftReport(existingTables, tablesWithColumns, tablesWithPrimaryKey);

      const extraTableDetail = report.details.find((d) => d.type === 'EXTRA_TABLE');
      expect(extraTableDetail).toBeDefined();
      expect(extraTableDetail!.severity).toBe('warning');
      expect(report.hasDrift).toBe(true);
      expect(report.hasCriticalDrift).toBe(false);
      expect(report.criticalCount).toBe(0);
      expect(report.warningCount).toBe(1);
    });
  });

  describe('pre-renamed target scenario', () => {
    it('flags the original table as missing when only the target exists', () => {
      // Simulate: rename migration already applied. The "old" table name
      // (which is the expected schema name) does not exist, but the target does.
      // If EXPECTED_TABLES includes "old_posts" but the DB has "posts" instead,
      // drift detection should flag MISSING_TABLE for "old_posts".
      const syntheticExpected = ['table_alpha', 'table_beta'];
      const existingInDatabase = new Set(['table_beta', 'table_gamma']);

      // Replicate the missing-table logic for a custom expected list
      const missing = syntheticExpected.filter((t) => !existingInDatabase.has(t));
      expect(missing).toEqual(['table_alpha']);
    });
  });

  describe('missing source scenario', () => {
    it('produces MISSING_TABLE for every absent expected table', () => {
      // Entire expected table absent from the database
      const existingTables = new Set<string>();
      const details = detectMissingTables(existingTables);

      // Every expected table is missing
      expect(details).toHaveLength(EXPECTED_TABLES.length);
      expect(details.every((d) => d.type === 'MISSING_TABLE')).toBe(true);
      expect(details.every((d) => d.severity === 'critical')).toBe(true);
    });
  });
});
