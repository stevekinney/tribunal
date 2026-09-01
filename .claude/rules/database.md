---
paths:
  - packages/database/**
  - applications/web/src/lib/server/database/**
  - applications/web/src/lib/server/review/**
  - packages/mcp/src/**
---

# Database patterns

Before editing paths in this rule, load `$database-operations` and apply its constraints.

Tribunal uses a flat Drizzle schema under `packages/database/src/schema/`. Schema modules export through `packages/database/src/schema/index.ts`; database consumers use the package exports from `packages/database/src/index.ts` and `packages/database/package.json`.

## Schema and migration workflow

- Change the TypeScript schema first, then generate an append-only migration with `bun run db:generate -- --name describe-your-change`.
- Review the generated SQL and metadata. Never edit an existing migration.
- Run `bun run db:check` for Drizzle consistency, `bun run --cwd packages/database check:migrations` for schema-to-migration consistency, and `bun run --cwd packages/database db:test-migrations` before merging a schema change.
- Use multi-phase migrations when removing or renaming live columns: add, backfill, update application reads and writes, then remove in a later deploy.
- Make backfills idempotent and index foreign-key columns. Use `CREATE INDEX CONCURRENTLY` when production table size requires it.

## Query and write behavior

- Avoid `db.transaction()` with the Neon HTTP driver. Express an atomic multi-table write as one data-modifying CTE so PostgreSQL owns commit and rollback.
- Prefer joins over N+1 reads and `selectDistinct` when joins can duplicate rows.
- Check the projection and side effects of a reader before using it at an authorization boundary. A helper named `get` may still upsert defaults or silently apply a limit.
- Return `null` for a missing row when that is the caller contract.
- Alias raw SQL snake-case columns to the camel-case names expected by TypeScript callers.
- Serialize raw `jsonb` parameters with `JSON.stringify()` and cast them explicitly. Drizzle inserts perform this conversion automatically.
- Set `updatedAt` explicitly in `onConflictDoUpdate`; Drizzle `$onUpdate` hooks do not run for conflict updates.
- Use `null`, not `undefined`, to clear a column in `.set()`. `undefined` means the column is omitted from the update.
- Catch PostgreSQL error `23505` when a unique constraint is the concurrency boundary. Do not rely on a check-then-insert read to prevent races.
- Gate status-driven updates on the expected current status so concurrent transitions are not overwritten.

## Schema constraints

- Choose an explicit `onDelete` action for every foreign key: `cascade`, `set null`, or `restrict`.
- Use `timestamp with time zone` for new timestamp columns.
- Scope catalog checks to the `public` schema when migrations inspect constraints or indexes.
- Keep database column names and TypeScript property names separate when computed Drizzle update keys need `sql.identifier()`.
- Normalize optional strings deliberately: use `value || null` when an empty string means no value, and `value ?? null` when an empty string is valid data.

See `packages/database/MIGRATIONS.md` for the complete migration contract.
