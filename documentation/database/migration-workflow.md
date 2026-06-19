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

## Pull request Neon branches

The pull request workflow creates a Neon branch for same-repository pull requests
targeting `main` through `.github/workflows/neon-pull-request-branches.yml`.

- Opening, reopening, or pushing to a pull request creates or reuses
  `preview/pr-<number>`.
- Retargeting a pull request also refreshes the branch if the pull request now
  targets `main`.
- Retargeting a pull request away from `main` deletes the matching Neon branch.
- Editing other pull request fields, such as the title or description, does not
  reset or migrate the Neon branch.
- Each create-and-migrate run resets the branch to its Neon parent before
  applying migrations, so validation runs against the current parent schema plus
  the pull request's migrations.
- The workflow runs `bun run db:migrate` against that branch, then runs
  `bun run --cwd packages/database db:validate-invariants`.
- Closing the pull request deletes the matching Neon branch. If the branch is
  already gone, cleanup exits successfully.

Required GitHub repository settings:

- Secret: `NEON_API_KEY`
- Variable: `NEON_PROJECT_ID`

Optional GitHub repository variables:

- `NEON_PARENT_BRANCH` (defaults to the Neon project's primary branch)
- `NEON_DATABASE_NAME` (defaults to `neondb`)
- `NEON_DATABASE_ROLE` (defaults to `neondb_owner`)
- `NEON_SUSPEND_TIMEOUT_SECONDS` (defaults to `300`)
