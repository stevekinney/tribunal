# Database schema guide

This module owns the PostgreSQL schema for Tribunal. The canonical schema lives
in `packages/database/src/schema/` (`@tribunal/database`) and is managed with
Drizzle ORM against Neon (HTTP driver).

## Overview

- Schema files live in `packages/database/src/schema/`, with tables, enums
  (`enums.ts`), and Drizzle relations (`relations.ts`) split per file and
  re-exported from `schema/index.ts`.
- Production database is Neon PostgreSQL; E2E runs against PGlite.
- Database entry point: `src/lib/server/database/index.ts`, which wraps
  `createDatabase` from `@tribunal/database`.

## Data model

The model is flat and GitHub-centric. The core chain is:

```
user → github_installation → github_installation_repository → repository
```

- A `user` connects one or more GitHub App installations (`github_installation`).
- Each installation grants access to repositories through the
  `github_installation_repository` join table.
- `repository` rows are keyed by the natural GitHub repo ID.
- `pull_request_state` (and `pull_request_trigger`) reference `repository` and
  track per-pull-request state derived from GitHub webhooks.

Supporting tables:

- **Auth/identity**: Neon Auth owns identity and sessions. Tribunal exports
  `user` with `neon_auth_user_id`, plus `oauth_connection` for encrypted GitHub
  API tokens and `user_api_key`.
- **Webhooks**: `webhook_event` (references `repository`) and
  `github_webhook_delivery` for delivery-claim/idempotency.
- **Workflow tables**: `workflow_run`, `workflow_config`, and
  `workflow_issue_reference` exist in the schema and still carry a
  `workspaceId` column and workflow identifier fields. They are residual: there
  is no workers/Temporal runtime in this repository, and webhook handlers
  currently log rather than dispatch any workflow. Treat them as inert storage
  until a producer is wired up.

## Timestamps

Tables use `createdAt` and `updatedAt` (with `$onUpdate`) as standard fields.

## Neon HTTP constraints

The connection uses `drizzle-orm/neon-http` (see
`packages/database/src/connection.ts`):

- No `db.transaction()` (unsupported by neon-http).
- Use CTEs for atomic multi-step writes where possible.
- When sequencing inserts, perform compensating deletes on failure.
- Use optimistic locking with status guards in CTE updates.

## Migration workflow

Schema changes use a migration-first workflow (scripts in the repo root
`package.json`):

```bash
# After editing schema files:
bun run db:generate    # drizzle-kit generate
bun run db:check        # drizzle-kit check
```

## Query patterns

See `.claude/rules/database.md` for:

- SELECT patterns
- INSERT/UPDATE patterns
- Race condition handling

## Testing

- E2E uses PGlite for per-worker isolation (`test/end-to-end/database.ts`).
- AsyncLocalStorage routes each request to the correct worker DB via
  `runWithDatabase` (`packages/database/src/connection.ts`); the lazy `db` proxy
  in `index.ts` honors that override so tests can swap in PGlite per request.
