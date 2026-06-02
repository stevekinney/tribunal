---
paths:
  - src/lib/server/database/**
  - src/lib/server/db/**
  - packages/database/drizzle.config.ts
---

# Database patterns

Before editing paths in this rule, load `$database-operations` and apply its constraints.

- Schema changes follow a **migration-first** workflow. Edit the TypeScript schema, run `bun run db:generate -- --name describe-your-change`, review the generated SQL, and commit it alongside the schema change. See `documentation/DATABASE.md` for the full workflow.
- Avoid `db.transaction()` with neon-http (not supported).
- Prefer joins to avoid N+1 queries.
- Use `selectDistinct` for deduping join results instead of post-processing.
- Keep query helpers pure; return `null` for "not found" when callers expect it.
- When using raw SQL with `db.execute`, alias returned snake_case columns to camelCase if callers expect schema types.
- Avoid updating the same row multiple times in writable CTEs; consolidate updates and gate inserts with the optimistic lock filter.
- For "exactly one scope" constraints, use `onDelete: 'cascade'` on scope FKs (or relax the constraint) so deletes do not fail.
- **All foreign key references must specify `onDelete` behavior.** PostgreSQL defaults to `NO ACTION`, which silently blocks parent row deletion. Always choose `cascade`, `set null`, or `restrict` explicitly. Omitting `onDelete` is treated as a review issue.
- When inserting jsonb values in raw SQL, manually serialize with `JSON.stringify()` and cast: `${value ? JSON.stringify(value) : null}::jsonb`. Drizzle's type-safe `db.insert()` handles this automatically, but raw `db.execute(sql\`...\`)` does not.
- For `onConflictDoUpdate` upserts, include `updatedAt: new Date()` in the `set` clause; Drizzle `$onUpdate` hooks do not run on conflict updates.
- In Drizzle `.set()` calls, use `null` (not `undefined`) to clear a column. `undefined` means "don't update this column", so conditional timestamps like `deliveredAt: status === 'delivered' ? now : undefined` silently preserve stale values instead of clearing them.
- **Use `timestamp with time zone` for new tables.** Newer tables (notifications, webhook delivery) use `{ withTimezone: true }` for timestamp columns. This ensures consistent behavior when database and application servers are in different timezones. Particularly important for scheduling timestamps like `nextAttemptAt` or `expiresAt`.

## Migration safety checks

- When checking for constraint existence in SQL migrations, filter by schema (`connamespace = 'public'::regnamespace`) to avoid matching identically named constraints in other schemas. For index existence checks, use schema-qualified `to_regclass('public.index_name')` or join `pg_class` to `pg_namespace` via `relnamespace`.

## Drizzle computed properties with sql.identifier

When using computed property names in `onConflictDoUpdate` set clauses with `sql.identifier()`, maintain separate mappings for DB column names (snake_case) and TypeScript property names (camelCase):

```typescript
// Map event types to both DB column names and TS property names
const EVENT_TYPE_TO_COUNTER: Record<EventType, { dbColumn: string; jsProperty: string }> = {
  'event.created': { dbColumn: 'created_count', jsProperty: 'createdCount' },
  'event.updated': { dbColumn: 'updated_count', jsProperty: 'updatedCount' },
};

// Use jsProperty for the object key, dbColumn for sql.identifier
.onConflictDoUpdate({
  set: {
    [counterMapping.jsProperty]: sql`${sql.identifier(counterMapping.dbColumn)} + 1`,
  },
})
```

Without this separation, Drizzle cannot recognize the computed property key because:
- `sql.identifier()` requires the DB column name (snake_case)
- The TypeScript object key must match the schema property name (camelCase)
- Using only snake_case breaks Drizzle's type checking and prevents the update

## Versioned entities

- `goalVersion` uses `onDelete: 'cascade'` on the `goalId` FK, so deleting a goal automatically cleans up all associated versions.
- When creating versioned entities, the initial version should be created alongside the entity to maintain invariant that versioned entities always have at least one version.
- If the main table enforces an "exactly one scope" rule, mirror the same check constraint on the version table to keep history consistent.
- **Unique index on version number**: The unique constraint should be on `(entityId, versionNumber)`, not `(parentId, versionNumber)`. For example, `answerVersion` uses `(answerId, versionNumber)` not `(questionId, versionNumber)` because version numbers are per-entity, not per-parent.

### Race conditions with unique constraints

When creating entities with unique constraints, the check-then-insert pattern has a race condition: two concurrent requests can both pass the existence check and both attempt to insert. Handle this by catching Postgres error code `23505`:

### Race conditions with status-driven updates

When a CTE updates related entities based on status (e.g., setting question status to `'answered'` when an answer is created), always include the expected status in the WHERE clause. Under read-committed isolation, a concurrent request could change the status after the CTE begins, causing your update to overwrite valid state transitions:

```sql
-- WRONG: Unconditionally sets status, may clobber concurrent archive
UPDATE question
SET status = 'answered', updated_at = NOW()
FROM inserted_answer
WHERE question.id = $questionId
RETURNING question.id

-- CORRECT: Only update if still in expected state
UPDATE question
SET status = 'answered', updated_at = NOW()
FROM inserted_answer
WHERE question.id = $questionId
  AND question.status = 'active'  -- Gate on expected state
RETURNING question.id
```

If no rows are returned, the question was concurrently modified—return an appropriate error rather than silently succeeding with stale data.

```typescript
try {
  const [inserted] = await db.insert(table.entity).values({ ... }).returning();
  // ...
} catch (error) {
  // Handle unique constraint violation (Postgres error code 23505)
  if (error instanceof Error && 'code' in error && error.code === '23505') {
    return { success: false, error: 'Entity already exists' };
  }
  throw error;
}
```

### Version restore validation

When restoring a previous version, re-validate all FK references to ensure they are still valid and within scope:

- **Projects**: Verify the referenced project still belongs to the same workspace. Projects can be moved or deleted.
- **Repositories**: Verify the repository is still linked to a project in this workspace AND user still has access via `canViewRepository`. Repos can be unlinked or permissions changed.
- **Parent goals**: Verify the parent is in the same workspace AND wouldn't create a cycle (use `wouldCreateCycle` helper). Goals can be moved or hierarchy changed.

For restore operations, prefer nulling out invalid references rather than erroring, since the user likely wants to restore the other fields even if some FK references are stale.

## Hierarchical data (parent-child relationships)

When entities can reference a parent of the same type (e.g., goals with `parentGoalId`):

1. **Cycle detection**: Before setting a parent reference, verify it won't create a circular chain. Use a helper like `wouldCreateCycle(entityId, proposedParentId)` that walks up the ancestor chain.

2. **Scope validation**: Verify the parent is in the same scope (workspace) as the child. Cross-workspace parent references break data isolation.

3. **Null for invalid**: When restoring versions, if the parent reference is invalid (deleted, moved, or would create cycle), null it out rather than erroring.

```typescript
// Example cycle detection pattern
// The visited Set detects both:
// 1. The target node appearing in the ancestor chain (requested cycle)
// 2. Data corruption where a cycle already exists (A -> B -> C -> A)
async function wouldCreateCycle(goalId: number, proposedParentId: number): Promise<boolean> {
  const MAX_DEPTH = 100; // Final safety net
  const visited = new Set<number>();
  let currentId: number | null = proposedParentId;
  let depth = 0;

  while (currentId !== null && depth < MAX_DEPTH) {
    if (currentId === goalId) return true; // Would create cycle
    if (visited.has(currentId)) return true; // Existing cycle in hierarchy
    visited.add(currentId);
    const parent = await getGoalParent(currentId);
    currentId = parent?.parentGoalId ?? null;
    depth++;
  }
  return false;
}
```

## Workspace-scoped vs project-scoped entities

Some entities (like goals) can be either workspace-scoped (`projectId: null`) or project-scoped (`projectId: number`). When updating these entities:

- **Preserve original scope**: Don't force a projectId during updates. If an entity was created as workspace-scoped, keep it that way unless explicitly changing scope.
- **Access via workspace**: Workspace-scoped entities should be accessible from any project view within that workspace, not just a single project.

## Upsert patterns for bulk operations

When processing bulk operations on entities with unique constraints (e.g., one answer per question), check for existing records and update them instead of failing on create:

```typescript
for (const item of items) {
  const existing = await service.getExistingEntity(userId, item.foreignKeyId);

  let result;
  if (existing) {
    result = await service.updateEntity(userId, existing.id, item.data);
  } else {
    result = await service.createEntity(userId, item.foreignKeyId, item.data);
  }

  if (!result.success) {
    errors[item.foreignKeyId] = result.error;
  }
}
```

This pattern allows resubmission after partial success and supports updating previously submitted data.

## Resource cleanup in async initialization

When initializing database connections or other resources in async functions, wrap the post-creation logic in try-catch to ensure cleanup on failure:

```typescript
async function initializeDatabase(): Promise<DatabaseInstance> {
  const client = new DatabaseClient();

  try {
    await client.runMigrations();  // Can throw
    return { client, db: client.getDatabase() };
  } catch (error) {
    // Clean up the client to prevent resource leak
    try {
      await client.close();
    } catch (closeError) {
      console.warn('Failed to close client after init failure:', closeError);
    }
    throw error;
  }
}
```

Without cleanup, resources created before the failure are leaked—they're never stored in the tracking structure, so they can't be closed later.

## Empty string vs null in PostgreSQL

Empty strings (`''`) and `NULL` have different semantics in PostgreSQL:
- Empty string is a valid non-null value
- Unique constraints treat `''` as a value that must be unique (unlike `NULL` which is excluded via partial indexes)

When accepting optional string fields from JavaScript:
- `value ?? null` preserves empty string (falsy in JS, non-null in PG)
- `value || null` converts empty string to null (usually desired for optional identifiers)

Use `|| null` for fields like idempotency keys where empty string should be treated as "no value":

```typescript
// WRONG: Empty string is stored and enforces uniqueness
const idempotencyKey = data.idempotencyKey ?? null;

// CORRECT: Empty string normalized to null
const idempotencyKey = data.idempotencyKey || null;
```

## Migration Conventions

All database migrations must follow patterns documented in `packages/database/MIGRATIONS.md`.

**Critical rules:**
- Never edit existing migrations (append-only)
- Multi-phase renames (column/table): add → backfill → app dual-write → drop
- All backfills must be idempotent (use WHERE clause)
- CREATE INDEX CONCURRENTLY for large tables
- All FK columns must have indexes
- Timestamp columns use `timestamp with time zone`

**Before generating migration:**
```bash
bun run db:generate -- --name describe-your-change
```

**Before merging PR with schema changes:**
```bash
bun run db:test-migrations
```

See `packages/database/MIGRATIONS.md` for complete guide.
