/**
 * Test helpers for migration validation tests.
 *
 * Provides factory functions that produce mock database row arrays
 * matching the shape returned by the information_schema queries
 * in validate-invariants.ts and detect-drift.ts.
 */

/**
 * Create mock rows for the `information_schema.tables` query.
 * Each row has a `table_name` field matching the public schema convention.
 */
export function createMockTableRows(tables: string[]): Array<{ table_name: string }> {
  return tables.map((table) => ({ table_name: table }));
}

/**
 * Create mock rows representing foreign key columns that are missing indexes.
 * An empty array means all FK columns are indexed (check passes).
 * Non-empty means unindexed FK columns were found (check fails).
 */
export function createMockForeignKeyRows(
  unindexed: Array<{ table: string; column: string; constraint: string }>,
): Array<{ table_name: string; column_name: string; constraint_name: string }> {
  return unindexed.map(({ table, column, constraint }) => ({
    table_name: table,
    column_name: column,
    constraint_name: constraint,
  }));
}

/**
 * Create mock rows for the migration count query.
 * The query returns a single row with a `count` field.
 */
export function createMockMigrationCountRows(count: number): Array<{ count: number }> {
  return [{ count }];
}

/**
 * Create mock rows representing timestamp columns without timezone.
 * Each violation is a table/column pair that uses `timestamp without time zone`
 * when `timestamp with time zone` is expected.
 */
export function createMockTimestampRows(
  violations: Array<{ table: string; column: string }>,
): Array<{ table_name: string; column_name: string; data_type: string }> {
  return violations.map(({ table, column }) => ({
    table_name: table,
    column_name: column,
    data_type: 'timestamp without time zone',
  }));
}

/**
 * Create mock rows representing columns that allow NULL but should not.
 * The query filters for `id`, `created_at`, and `updated_at` columns
 * where `is_nullable = 'YES'`.
 */
export function createMockNullableRows(
  violations: Array<{ table: string; column: string }>,
): Array<{ table_name: string; column_name: string; is_nullable: string }> {
  return violations.map(({ table, column }) => ({
    table_name: table,
    column_name: column,
    is_nullable: 'YES',
  }));
}

/**
 * Create mock rows representing missing unique constraints.
 * An empty array means all expected unique constraints exist (check passes).
 * Non-empty means some expected unique constraints are missing (check fails).
 */
export function createMockUniqueRows(
  missing: Array<{ table: string; column: string }>,
): Array<{ table_name: string; column_name: string }> {
  return missing.map(({ table, column }) => ({
    table_name: table,
    column_name: column,
  }));
}

/**
 * Create mock rows representing columns using `character varying` (varchar)
 * instead of `text`. Used by the `prefer_text_over_varchar` check.
 */
export function createMockVarcharRows(
  columns: Array<{ table: string; column: string; length: number }>,
): Array<{
  table_name: string;
  column_name: string;
  data_type: string;
  character_maximum_length: number;
}> {
  return columns.map(({ table, column, length }) => ({
    table_name: table,
    column_name: column,
    data_type: 'character varying',
    character_maximum_length: length,
  }));
}
