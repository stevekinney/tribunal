# Check matrix

Every automated check that runs across git hooks and CI, with its authoritative context and gating conditions. Tribunal is a single SvelteKit app (`applications/web`) plus shared `@tribunal/*` packages (`packages/*`). Every check below targets `applications/web` or `packages/*`.

## Check inventory

| Check                        | Pre-commit                       | Pre-push                                           | CI                                                                                        | Scope                     | Gating                                      |
| ---------------------------- | -------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------- | ------------------------------------------- |
| Lockfile sync                | `HOOKS_STRICT=1` only            | —                                                  | (via `setup` action's `bun install`)                                                      | Full                      | Always                                      |
| Prettier + ESLint (staged)   | `lint-staged` + `turbo run lint` | —                                                  | —                                                                                         | Staged / changed packages | Always                                      |
| Prettier (full)              | —                                | —                                                  | `bun run format:check`                                                                    | Full repo                 | Always                                      |
| ESLint (full)                | —                                | —                                                  | `bunx turbo run lint`                                                                     | Full repo                 | Always (turbo `--affected` on PRs)          |
| Type check (svelte-check)    | —                                | `HOOKS_STRICT=1` only                              | `bunx turbo run check`                                                                    | Full repo                 | Always (turbo `--affected` on PRs)          |
| Unit tests (server + client) | `HOOKS_STRICT=1` only            | —                                                  | `bunx turbo run test` (packages) + `applications/web test:unit:server`/`test:unit:client` | Changed / Full            | Always (browser gated on relevant changes)  |
| Component tests              | —                                | —                                                  | `bun run --cwd packages/components test:client`                                           | `packages/components`     | Browser-testable paths changed              |
| Storybook tests              | —                                | `bun run --cwd packages/components test:storybook` | `bun run --cwd packages/components test:storybook`                                        | `packages/components`     | Storybook paths changed                     |
| E2E tests                    | —                                | —                                                  | `bun run --cwd applications/web test:e2e`                                                 | `applications/web`        | Browser-testable paths changed              |
| Build verification           | —                                | `HOOKS_STRICT=1` only                              | `bunx turbo run build`                                                                    | Full                      | Always (turbo `--affected` on PRs)          |
| Migration consistency        | Schema files staged              | —                                                  | `bun run db:check` + apply loop + structure verify + drift check                          | `packages/database/`      | Always (push check gated on schema changes) |

## Authoritative context policy

CI is the authoritative gate for all checks. Git hooks provide early, fast feedback but are skippable (e.g., `--no-verify`). A check must pass in CI before merging.

For on-demand full local validation, use `bun run verify`, which runs the CI checks plus hook-only gates (migration consistency, Storybook tests) sequentially with a pass/fail summary.

| Check                 | Authority       | Hook role                                                   |
| --------------------- | --------------- | ----------------------------------------------------------- |
| Lockfile sync         | CI              | `HOOKS_STRICT=1` pre-commit only                            |
| Prettier              | CI (full)       | Pre-commit formats staged files only via lint-staged        |
| ESLint                | CI (full)       | Pre-commit lints changed packages only via `turbo run lint` |
| Type check            | CI              | `HOOKS_STRICT=1` pre-push only                              |
| Unit tests            | CI (full)       | `HOOKS_STRICT=1` pre-commit only (`--changed --bail 1`)     |
| Component / E2E tests | CI              | No hook equivalent; CI only                                 |
| Storybook tests       | CI + Pre-push   | Pre-push provides additional local feedback                 |
| Build verification    | CI              | `HOOKS_STRICT=1` pre-push only                              |
| Migration consistency | CI + Pre-commit | Pre-commit when schema files staged; CI always              |

## CI job structure

CI runs eight jobs in parallel, gated by a single `ci-status` aggregation job:

| Job                 | Steps                                                               | Notes                                          |
| ------------------- | ------------------------------------------------------------------- | ---------------------------------------------- |
| `type-check`        | `turbo run check` (with `--affected` on PRs)                        | 8GB heap; runs upstream builds via turbo graph |
| `lint-format`       | `format:check` + `turbo run lint` (with `--affected` on PRs)        | 8GB heap for ESLint                            |
| `test-unit`         | Package tests (`turbo run test`) + server unit tests                | Node environment only                          |
| `test-browser`      | Browser unit tests + component tests + E2E tests                    | Gated on browser-testable changes (PRs)        |
| `test-storybook`    | Storybook tests                                                     | Gated on storybook path changes (PRs)          |
| `build`             | `turbo run build` (with `--affected` on PRs)                        | Placeholder `DATABASE_URL` for SvelteKit build |
| `migration`         | `db:check` + psql apply loop + structure verification + drift check | Postgres service container                     |
| `schema-push-check` | `drizzle-kit push` against a throwaway Neon branch                  | PRs only; gated on schema changes              |
| `ci-status`         | Aggregates all job results; fails if any job failed or cancelled    | Branch protection checks this single job       |

Change detection uses Turborepo's `--affected` flag (dependency-graph-aware) for `check`, `lint`, and `build`. The `test-browser`, `test-storybook`, and `schema-push-check` jobs use inline `git diff` checks against the PR base so expensive work only runs when the relevant files change. On pushes to `main`, the gated jobs always run.

The `migration` job applies every numbered SQL file in `packages/database/drizzle/` against a Postgres service container, verifies the resulting schema structure (table count and applied-file-count vs. the journal), and replays historical rename/missing-table scenarios to guard against regressions in migration ordering. It finishes with a drift check (`bun run --cwd packages/database check:migrations`) that fails if the committed migrations diverge from the schema definitions.

The `schema-push-check` job (pull requests only) provisions a temporary Neon branch, runs `drizzle-kit push` against it, and deletes the branch afterward so schema changes are validated against a real Postgres without touching shared environments.

## Notes on CI separation

- **Prettier and ESLint are separate CI steps.** Running both in one process pushed ESLint over the runner's memory limit, so `bun run format:check` runs as a lightweight standalone step, separate from `turbo run lint` (which gets `--max-old-space-size=8192`). Each tool still runs exactly once.
- **`bun run check` runs `svelte-kit sync` first**, ensuring `.svelte-kit/tsconfig.json` exists before ESLint's TypeScript project service resolves the root `tsconfig.json`.

## Skip conditions

| Mechanism                   | Where      | Effect                                                                            |
| --------------------------- | ---------- | --------------------------------------------------------------------------------- |
| `HOOKS_STRICT=1`            | Pre-commit | Enables lockfile sync and unit tests                                              |
| `HOOKS_STRICT=1`            | Pre-push   | Enables type check and build                                                      |
| `SKIP_TESTS=1`              | Pre-commit | Skips the `precommit:tests` step (within `HOOKS_STRICT`)                          |
| File-gating (JS/TS/Svelte)  | Pre-commit | Skips lint and unit tests if no code files changed                                |
| File-gating (JS/TS/Svelte)  | Pre-push   | Skips type check / build if no relevant files changed                             |
| File-gating (schema)        | Pre-commit | Runs migration consistency only when `packages/database/src/schema/` files staged |
| File-gating (Storybook)     | Pre-push   | Skips Storybook tests if no relevant files changed                                |
| Turbo `--affected`          | CI         | Limits `check`, `lint`, and `build` to packages affected by the PR's changes      |
| Inline `git diff` detection | CI         | Skips browser, Storybook, and schema-push jobs when no relevant files change      |
