# Script Ownership Map

Tracks runnable script entrypoints, their owning workspace, and primary callers.
Updated as part of.

## Root Scripts (`scripts/`)

Cross-workspace orchestration and developer tooling that does not belong to a
single package.

| Entrypoint                      | Purpose                            | Callers                                  |
| ------------------------------- | ---------------------------------- | ---------------------------------------- |
| `verify.ts`                     | Full local verification suite      | `bun run verify`                         |
| `precommit-tests.ts`            | Pre-commit test runner             | `bun run precommit:tests`, Lefthook hook |
| `get-pr-comments.ts`            | Fetch PR review comments           | `/address-pr` skill                      |
| `extract-ticket-from-branch.ts` | Parse Linear ticket ID from branch | CI scripts                               |
| `doctor.ts`                     | Monorepo health check              | Manual                                   |

### Root Scripts — Shared Libraries (`scripts/lib/`)

| Module                | Purpose                              | Consumers                              |
| --------------------- | ------------------------------------ | -------------------------------------- |
| `colors.ts`           | Chalk-based CLI styling              | All root scripts                       |
| `load-env.ts`         | `.env` file loader                   | Root scripts, copied to workspace libs |
| `repository-root.ts`  | Repo root path resolution            | Root scripts, copied to workspace libs |
| `planning-context.ts` | Planning context gathering           | Agent scripts                          |
| `review-memory.ts`    | Learning-file loading and formatting | Agent scripts                          |

### Root Scripts — Skill Context (`scripts/skill-context/`)

| Entrypoint                 | Purpose                                   | Callers      |
| -------------------------- | ----------------------------------------- | ------------ |
| `list-review-learnings.ts` | List review learnings for skill injection | Agent skills |

## `packages/database/scripts/`

Database-domain scripts owned by `@tribunal/database`.

| Entrypoint                       | Purpose                          | Callers                                                                 |
| -------------------------------- | -------------------------------- | ----------------------------------------------------------------------- |
| `check-migration-consistency.ts` | Detect schema-to-migration drift | `bun run --cwd packages/database check:migrations`, `scripts/verify.ts` |
| `list-database-tables.ts`        | List schema table names          | `bun run --cwd packages/database db:tables`                             |

## Ownership Rules

1. **Database scripts** live in `packages/database/scripts/` — not root `scripts/`.
2. **Test wrappers** live in their consuming workspace's `scripts/` directory.
3. **Cross-workspace orchestration** lives in root `scripts/`.
4. **Workspace scripts** import utilities from their own `scripts/lib/` — never from `../../scripts/lib/`.
5. Verification guards in `scripts/verify.ts` enforce these boundaries at CI time.
