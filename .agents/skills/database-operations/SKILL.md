---
name: database-operations
description: Operate and validate PostgreSQL/Drizzle workflows for schema migrations, query design, indexing, Neon constraints, and performance diagnostics.
allowed-tools:
  - Bash
  - Read
  - Grep
  - Glob
  - Write
  - Edit
---

# Database Operations

## When to use

- Creating or validating schema migrations
- Scaffolding new tables, relations, and indexes
- Designing/updating Drizzle queries and upsert behavior
- Diagnosing query plan bottlenecks with EXPLAIN
- Auditing index coverage/duplicates/bloat

## Do not use

- Production data mutation workflows
- Pure architecture questions that do not require code or schema changes

## Constraints

- Follow `{baseDir}/rules/database.md`
- Respect Neon pooled/transaction limitations (`db.transaction()` is unavailable on neon-http)
- Never seed production data
- Include explicit `onDelete` behavior for foreign keys
- Ensure foreign key columns are indexed

## Operation modes

### 1) New migration

- Update schema definitions
- Generate migration
- Validate SQL + compatibility impact
- Regenerate schemas and type-check

### 2) Table scaffolding

- Use project PK/timestamp/index conventions
- Export table types/relations
- Generate migration and schemas

### 3) Query design and upsert safety

- Prefer query-builder joins over N+1 loops
- Use CTEs for atomic multi-step writes on neon-http
- Include `updatedAt` explicitly in conflict-update paths
- Use `null` (not `undefined`) to clear columns in `.set()`

### 4) Performance diagnostics

- Run EXPLAIN/EXPLAIN ANALYZE on representative queries
- Identify scan/sort/join bottlenecks
- Recommend concrete query/index rewrites

### 5) Index audit

- Identify missing FK indexes, duplicates, and low-value indexes
- Provide prioritized add/drop/reindex recommendations

## Workflow

1. Determine mode from request and touched files.
2. Gather schema/query context for the affected tables and services.
3. Execute only the relevant mode checklist.
4. Report exact commands, files, and follow-up SQL/actions.

## Verification

- `bun run db:check`
- `bun run check`
- Mode-specific checks (query plan reruns, index verification queries, migration review)

## Additional reference

- [Database Domain Reference](references/database-domain-reference.md)
