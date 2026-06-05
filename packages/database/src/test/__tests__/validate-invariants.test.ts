import { describe, it, expect } from 'vitest';
import { invariantChecks, EXPECTED_TABLES } from '../validate-invariants';
import type { InvariantCheck } from '../validate-invariants';
import {
  createMockTableRows,
  createMockForeignKeyRows,
  createMockMigrationCountRows,
  createMockTimestampRows,
  createMockNullableRows,
  createMockUniqueRows,
  createMockVarcharRows,
} from '../helpers';

/**
 * Look up an invariant check by name from the exported array.
 * Throws if the check is not found so tests fail fast with a clear message.
 */
function getCheck(name: string): InvariantCheck {
  const check = invariantChecks.find((c) => c.name === name);
  if (!check) {
    throw new Error(`Invariant check "${name}" not found in invariantChecks array`);
  }
  return check;
}

describe('validate-invariants', () => {
  describe('EXPECTED_TABLES', () => {
    it('contains a non-empty list of table names', () => {
      expect(EXPECTED_TABLES.length).toBeGreaterThan(0);
    });

    it('contains only unique table names', () => {
      const unique = new Set(EXPECTED_TABLES);
      expect(unique.size).toBe(EXPECTED_TABLES.length);
    });

    it('contains known critical tables', () => {
      const criticalTables = [
        'user',
        'repository',
        'pull_request_state',
        'workflow_run',
        'github_installation',
        'oauth_connection',
      ];
      for (const table of criticalTables) {
        expect(EXPECTED_TABLES).toContain(table);
      }
    });

    it('contains auxiliary tables across the flat data model', () => {
      const parityTables = ['user_api_key', 'github_webhook_delivery', 'webhook_event'];
      for (const table of parityTables) {
        expect(EXPECTED_TABLES).toContain(table);
      }
    });

    it('is deterministically sorted', () => {
      const sorted = [...EXPECTED_TABLES].sort((left, right) => {
        if (left < right) {
          return -1;
        }
        if (left > right) {
          return 1;
        }
        return 0;
      });
      expect(EXPECTED_TABLES).toEqual(sorted);
    });
  });

  describe('invariantChecks array', () => {
    it('exports exactly 7 checks', () => {
      expect(invariantChecks).toHaveLength(7);
    });

    it('has unique names for every check', () => {
      const names = invariantChecks.map((c) => c.name);
      expect(new Set(names).size).toBe(names.length);
    });

    it('has a valid severity for every check', () => {
      for (const check of invariantChecks) {
        expect(['error', 'warning']).toContain(check.severity);
      }
    });

    it('has a non-empty query for every check', () => {
      for (const check of invariantChecks) {
        expect(check.query.trim().length).toBeGreaterThan(0);
      }
    });
  });

  describe('all_schema_tables_exist', () => {
    const check = getCheck('all_schema_tables_exist');

    it('has error severity', () => {
      expect(check.severity).toBe('error');
    });

    it('passes when all expected tables are present in database', () => {
      const rows = createMockTableRows([...EXPECTED_TABLES, '__drizzle_migrations']);
      expect(check.validate(rows)).toBe(true);
    });

    it('passes when database has extra tables beyond expected', () => {
      const rows = createMockTableRows([
        ...EXPECTED_TABLES,
        'some_extra_table',
        '_prisma_migrations',
      ]);
      expect(check.validate(rows)).toBe(true);
    });

    it('fails when one table is missing', () => {
      const tablesMinusOne = EXPECTED_TABLES.slice(1);
      const rows = createMockTableRows(tablesMinusOne);
      expect(check.validate(rows)).toBe(false);
    });

    it('fails when multiple tables are missing', () => {
      const partialTables = EXPECTED_TABLES.slice(0, 5);
      const rows = createMockTableRows(partialTables);
      expect(check.validate(rows)).toBe(false);
    });

    it('fails when database is empty', () => {
      const rows = createMockTableRows([]);
      expect(check.validate(rows)).toBe(false);
    });
  });

  describe('foreign_keys_have_indexes', () => {
    const check = getCheck('foreign_keys_have_indexes');

    it('has error severity', () => {
      expect(check.severity).toBe('error');
    });

    it('passes when no unindexed foreign keys are found (empty result)', () => {
      const rows = createMockForeignKeyRows([]);
      expect(check.validate(rows)).toBe(true);
    });

    it('fails when one foreign key column lacks an index', () => {
      const rows = createMockForeignKeyRows([
        { table: 'pull_request_state', column: 'repository_id', constraint: 'fk_repo' },
      ]);
      expect(check.validate(rows)).toBe(false);
    });

    it('fails when multiple foreign key columns lack indexes', () => {
      const rows = createMockForeignKeyRows([
        { table: 'pull_request_state', column: 'repository_id', constraint: 'fk_repo' },
        { table: 'goal_connection', column: 'source_goal_id', constraint: 'fk_source_goal' },
        { table: 'goal_connection', column: 'target_goal_id', constraint: 'fk_target_goal' },
      ]);
      expect(check.validate(rows)).toBe(false);
    });
  });

  describe('migrations_table_populated', () => {
    const check = getCheck('migrations_table_populated');

    it('has error severity', () => {
      expect(check.severity).toBe('error');
    });

    it('passes when migration count is greater than zero', () => {
      const rows = createMockMigrationCountRows(42);
      expect(check.validate(rows)).toBe(true);
    });

    it('passes with exactly one migration', () => {
      const rows = createMockMigrationCountRows(1);
      expect(check.validate(rows)).toBe(true);
    });

    it('fails when migration count is zero', () => {
      const rows = createMockMigrationCountRows(0);
      expect(check.validate(rows)).toBe(false);
    });

    it('fails when result rows are empty', () => {
      expect(check.validate([])).toBe(false);
    });

    it('handles string count values returned by some drivers', () => {
      // Some PostgreSQL drivers return count as a string
      const rows = [{ count: '15' }];
      expect(check.validate(rows)).toBe(true);
    });

    it('fails with string zero count', () => {
      const rows = [{ count: '0' }];
      expect(check.validate(rows)).toBe(false);
    });
  });

  describe('timestamps_have_timezone', () => {
    const check = getCheck('timestamps_have_timezone');

    it('has error severity', () => {
      expect(check.severity).toBe('error');
    });

    it('passes when no newer tables have timestamp violations', () => {
      const rows = createMockTimestampRows([]);
      expect(check.validate(rows)).toBe(true);
    });

    it('passes when only legacy tables have timestamp violations (grandfathered)', () => {
      // Legacy tables like "session" are not in the newer-table filter list
      const rows = createMockTimestampRows([
        { table: 'session', column: 'created_at' },
        { table: 'project', column: 'updated_at' },
      ]);
      expect(check.validate(rows)).toBe(true);
    });

    it('fails when pull_request_action_item has timestamp without timezone', () => {
      const rows = createMockTimestampRows([
        { table: 'pull_request_action_item', column: 'created_at' },
      ]);
      expect(check.validate(rows)).toBe(false);
    });

    it('fails when pull_request_action_item_source has timestamp without timezone', () => {
      const rows = createMockTimestampRows([
        { table: 'pull_request_action_item_source', column: 'created_at' },
      ]);
      expect(check.validate(rows)).toBe(false);
    });

    it('fails when github_webhook_delivery has timestamp without timezone', () => {
      const rows = createMockTimestampRows([
        { table: 'github_webhook_delivery', column: 'delivered_at' },
      ]);
      expect(check.validate(rows)).toBe(false);
    });

    it('fails when linear_webhook_delivery has timestamp without timezone', () => {
      const rows = createMockTimestampRows([
        { table: 'linear_webhook_delivery', column: 'delivered_at' },
      ]);
      expect(check.validate(rows)).toBe(false);
    });

    it('fails when multiple newer tables have violations', () => {
      const rows = createMockTimestampRows([
        { table: 'pull_request_action_item', column: 'created_at' },
        { table: 'github_webhook_delivery', column: 'delivered_at' },
        { table: 'session', column: 'created_at' }, // Legacy: not counted
      ]);
      expect(check.validate(rows)).toBe(false);
    });
  });

  describe('required_columns_not_null', () => {
    const check = getCheck('required_columns_not_null');

    it('has error severity', () => {
      expect(check.severity).toBe('error');
    });

    it('passes when no nullable id/timestamp columns exist (empty result)', () => {
      const rows = createMockNullableRows([]);
      expect(check.validate(rows)).toBe(true);
    });

    it('fails when an id column allows null', () => {
      const rows = createMockNullableRows([{ table: 'user', column: 'id' }]);
      expect(check.validate(rows)).toBe(false);
    });

    it('fails when created_at allows null', () => {
      const rows = createMockNullableRows([{ table: 'project', column: 'created_at' }]);
      expect(check.validate(rows)).toBe(false);
    });

    it('fails when updated_at allows null', () => {
      const rows = createMockNullableRows([{ table: 'repository', column: 'updated_at' }]);
      expect(check.validate(rows)).toBe(false);
    });

    it('fails when multiple columns across tables are nullable', () => {
      const rows = createMockNullableRows([
        { table: 'user', column: 'id' },
        { table: 'project', column: 'created_at' },
        { table: 'workspace', column: 'updated_at' },
      ]);
      expect(check.validate(rows)).toBe(false);
    });
  });

  describe('unique_constraints_exist', () => {
    const check = getCheck('unique_constraints_exist');

    it('has error severity', () => {
      expect(check.severity).toBe('error');
    });

    it('passes when no missing unique constraints are found (empty result)', () => {
      const rows = createMockUniqueRows([]);
      expect(check.validate(rows)).toBe(true);
    });

    it('fails when workflow_run is missing unique on workflow_id', () => {
      const rows = createMockUniqueRows([{ table: 'workflow_run', column: 'workflow_id' }]);
      expect(check.validate(rows)).toBe(false);
    });

    it('fails when pull_request_state is missing unique on repository_id', () => {
      const rows = createMockUniqueRows([{ table: 'pull_request_state', column: 'repository_id' }]);
      expect(check.validate(rows)).toBe(false);
    });

    it('fails when pull_request_action_item is missing unique on pull_request_state_id', () => {
      const rows = createMockUniqueRows([
        { table: 'pull_request_action_item', column: 'pull_request_state_id' },
      ]);
      expect(check.validate(rows)).toBe(false);
    });

    it('fails when multiple unique constraints are missing', () => {
      const rows = createMockUniqueRows([
        { table: 'workflow_run', column: 'workflow_id' },
        { table: 'pull_request_state', column: 'repository_id' },
        { table: 'pull_request_action_item', column: 'pull_request_state_id' },
      ]);
      expect(check.validate(rows)).toBe(false);
    });
  });

  describe('prefer_text_over_varchar', () => {
    const check = getCheck('prefer_text_over_varchar');

    it('has warning severity', () => {
      expect(check.severity).toBe('warning');
    });

    it('passes when no varchar columns exist (empty result)', () => {
      const rows = createMockVarcharRows([]);
      expect(check.validate(rows)).toBe(true);
    });

    it('returns false (warning) when varchar columns are found', () => {
      const rows = createMockVarcharRows([{ table: 'user', column: 'email', length: 255 }]);
      expect(check.validate(rows)).toBe(false);
    });

    it('returns false (warning) for multiple varchar columns', () => {
      const rows = createMockVarcharRows([
        { table: 'user', column: 'email', length: 255 },
        { table: 'project', column: 'slug', length: 100 },
        { table: 'repository', column: 'name', length: 200 },
      ]);
      expect(check.validate(rows)).toBe(false);
    });
  });
});
