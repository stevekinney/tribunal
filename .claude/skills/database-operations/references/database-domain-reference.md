# Database Domain Reference

This reference consolidates guidance from the prior database micro-skills into
the canonical `database-operations` domain pack.

## Schema conventions

- Default to integer identity PKs for internal entities.
- Use UUID PKs only when distributed/external identity is required.
- Use `timestamp(..., { withTimezone: true })` for new timestamp columns.
- Use `text()` over `varchar(n)` unless a hard constraint is required.
- Define FK `onDelete` explicitly and index FK columns.

## Query and write patterns

- Prefer query-builder joins for production reads.
- Use CTEs for atomic write flows instead of transactions on neon-http.
- On upserts, explicitly set update timestamps in conflict clauses.
- In `.set()`, use `null` to clear a value; `undefined` means "skip update".

## Performance and indexing

- Use EXPLAIN ANALYZE for bottleneck diagnosis.
- Ensure FK indexes exist for common joins/cascades.
- Prefer set-based operations and bulk lookups over per-row loops.
- Evaluate composite index leading column selectivity before adding indexes.

## Neon constraints

- Use pooled connection URLs for application workloads.
- Reserve unpooled/direct connections for migration/DDL workflows.
- Account for cold-start latency and avoid session-mode assumptions.
