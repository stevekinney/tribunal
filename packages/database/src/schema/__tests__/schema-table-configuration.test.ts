import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
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

  it('does not map webhook metadata retained only for deployment sequencing', () => {
    const deliveryColumns = getTableConfig(schema.githubWebhookDelivery).columns.map(
      (column) => column.name,
    );
    const eventColumns = getTableConfig(schema.webhookEvent).columns.map((column) => column.name);

    expect(deliveryColumns).toEqual(['id', 'delivery_id', 'event_type']);
    expect(eventColumns).toEqual([
      'id',
      'event_type',
      'action',
      'delivery_id',
      'payload',
      'repository_id',
      'installation_id',
      'sender_login',
      'pr_number',
      'issue_number',
      'ref',
      'commit_sha',
      'github_created_at',
      'received_at',
    ]);
  });

  it('uses type-correct operator classes for the introspected webhook received index', () => {
    const introspectedSchema = readFileSync(
      new URL('../../../drizzle/schema.ts', import.meta.url),
      'utf8',
    );
    const receivedIndex = introspectedSchema.match(
      /index\('webhook_event_repository_received_idx'\)[\s\S]*?\n {4}\),/,
    )?.[0];

    expect(receivedIndex).toContain("table.repositoryId.asc().nullsLast().op('int8_ops')");
    expect(receivedIndex).toContain("table.receivedAt.asc().nullsLast().op('timestamp_ops')");
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
