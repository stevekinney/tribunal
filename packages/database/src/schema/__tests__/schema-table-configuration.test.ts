import { describe, it, expect } from 'vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { createTableRelationsHelpers, getTableName, is, isTable, Relations } from 'drizzle-orm';
import * as schema from '../index';

/**
 * Exercises the lazy configuration paths every Drizzle table/relations
 * definition carries: the `extraConfig` callback that builds indexes/checks,
 * the `.references()` thunks that resolve foreign keys, and the `relations()`
 * callback that wires up `db.query.*` joins. None of these run merely by
 * importing the schema module -- Drizzle defers them to avoid resolving
 * circular table imports eagerly. `getTableConfig` and
 * `createTableRelationsHelpers` are the same primitives Drizzle itself uses
 * to resolve this configuration at query-build time.
 */
describe('schema table configuration', () => {
  const tables = Object.values(schema).filter(isTable) as Parameters<typeof getTableConfig>[0][];

  it('defines at least one table', () => {
    expect(tables.length).toBeGreaterThan(0);
  });

  it('does not expose the removed pull request action item dependency table', () => {
    const tableNames = tables.map((table) => getTableName(table));

    expect(tableNames).not.toContain('pull_request_action_item_dependency');
  });

  it('exposes only retained pull request action item columns', () => {
    const actionItemColumns = getTableConfig(schema.pullRequestActionItem).columns.map(
      (column) => column.name,
    );
    const actionItemSourceColumns = getTableConfig(schema.pullRequestActionItemSource).columns.map(
      (column) => column.name,
    );

    expect(actionItemColumns).toEqual([
      'id',
      'pull_request_state_id',
      'stable_key',
      'first_seen_head_sha',
    ]);
    expect(actionItemSourceColumns).toEqual([
      'id',
      'action_item_id',
      'source_type',
      'source_identifier',
    ]);
  });

  describe.each(tables.map((table) => [getTableName(table), table] as const))(
    '%s',
    (tableName, table) => {
      it('has a primary key, either on a column or as a table constraint', () => {
        const config = getTableConfig(table);
        const hasColumnPrimaryKey = config.columns.some((column) => column.primary);
        const hasCompositePrimaryKey = config.primaryKeys.length > 0;

        expect(hasColumnPrimaryKey || hasCompositePrimaryKey).toBe(true);
      });

      it('resolves every foreign key reference to a real target table and columns', () => {
        const config = getTableConfig(table);

        for (const foreignKey of config.foreignKeys) {
          const { columns, foreignColumns } = foreignKey.reference();

          expect(columns.length).toBeGreaterThan(0);
          expect(foreignColumns.length).toBe(columns.length);
          for (const foreignColumn of foreignColumns) {
            expect(foreignColumn.table).toBeDefined();
          }
        }
      });

      it(`has a table name of "${tableName}"`, () => {
        expect(getTableName(table)).toBe(tableName);
      });
    },
  );

  describe('relations', () => {
    const relationDefinitions = Object.entries(schema).filter(([, value]) => is(value, Relations));

    it('defines at least one relations config', () => {
      expect(relationDefinitions.length).toBeGreaterThan(0);
    });

    it.each(relationDefinitions)(
      '%s builds without throwing and yields named relations',
      (_key, relationDefinition) => {
        const relation = relationDefinition as InstanceType<typeof Relations>;
        const helpers = createTableRelationsHelpers(relation.table);
        const built = relation.config(helpers);

        expect(Object.keys(built).length).toBeGreaterThan(0);
      },
    );
  });
});
