# Migration Workflow

How database migrations flow in Tribunal. The data layer is Drizzle ORM over
PostgreSQL, in `packages/database`.

## How It Works

1. Edit the TypeScript schema in `packages/database/src/schema/`.
2. Generate a SQL migration with `bun run db:generate -- --name describe-change`.
3. Review the generated SQL and commit the schema change and migration together.
4. Apply migrations with `bun run db:migrate`.

The pre-commit hook runs a migration-consistency check
(`packages/database/scripts/check-migration-consistency.ts`) to catch
schema-vs-migration drift before a commit lands.

## Authoring guide

See **[Migration Authoring Guide](../../packages/database/MIGRATIONS.md)** for
patterns, anti-patterns, checklists, and SQL examples for writing safe migrations.

## Quick Commands

```bash
# Generate a migration after schema changes
bun run db:generate -- --name describe-your-change

# Apply pending migrations
bun run db:migrate

# Verify migration journal integrity
bun run db:check

# Open Drizzle Studio
bun run db:studio

# (from packages/database) run migration tests
bun run --cwd packages/database db:test-migrations

# (from packages/database) validate schema invariants
bun run --cwd packages/database db:validate-invariants

# (from packages/database) check for schema drift
bun run --cwd packages/database db:detect-drift

# (from packages/database) list tables in the database
bun run --cwd packages/database db:tables
```
