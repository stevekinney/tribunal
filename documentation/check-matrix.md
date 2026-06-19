# Check matrix

Every automated check that runs across git hooks and CI, with its authoritative context and gating conditions. Tribunal includes the SvelteKit web application (`applications/web`), the review engine (`applications/engine`), the proxy (`applications/proxy`), the reviewer runner image (`runner`), and shared `@tribunal/*` packages (`packages/*`).

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
| Container image smoke        | —                                | —                                                  | Docker build/boot for web, engine, proxy, reviewer                                        | Deployment images         | Always                                      |

## Authoritative context policy

CI is the authoritative gate for all checks. Git hooks provide early, fast feedback but are skippable (e.g., `--no-verify`). A check must pass in CI before merging.

For on-demand full local validation, use `bun run verify`, which runs the repository gates sequentially with a pass/fail summary: lockfile sync, type check, format check, lint, `bun run db:check`, web server/client unit tests, review-engine coverage, web E2E tests, build, and migration consistency.

| Check                 | Authority       | Hook role                                                   |
| --------------------- | --------------- | ----------------------------------------------------------- |
| Lockfile sync         | CI              | `HOOKS_STRICT=1` pre-commit only                            |
| Prettier              | CI (full)       | Pre-commit formats staged files only via lint-staged        |
| ESLint                | CI (full)       | Pre-commit lints changed packages only via `turbo run lint` |
| Type check            | CI              | `HOOKS_STRICT=1` pre-push only                              |
| Unit tests            | CI (full)       | `HOOKS_STRICT=1` pre-commit only (`--changed --bail 1`)     |
| E2E tests             | CI              | No hook equivalent; included in `bun run verify`            |
| Build verification    | CI              | `HOOKS_STRICT=1` pre-push only                              |
| Migration consistency | CI + Pre-commit | Pre-commit when schema files staged; CI always              |
| Container images      | CI              | No hook equivalent                                          |

## CI job structure

CI runs seven jobs in parallel, gated by a single `ci-status` aggregation job:

| Job                | Steps                                                               | Notes                                          |
| ------------------ | ------------------------------------------------------------------- | ---------------------------------------------- |
| `type-check`       | `turbo run check` (with `--affected` on PRs)                        | 8GB heap; runs upstream builds via turbo graph |
| `lint-format`      | `format:check` + `turbo run lint` (with `--affected` on PRs)        | 8GB heap for ESLint                            |
| `test-unit`        | Package tests (`turbo run test`) + server unit tests                | Node environment only                          |
| `test-browser`     | Browser unit tests + web Playwright E2E tests + dev-server smoke    | Gated on browser-testable changes (PRs)        |
| `build`            | `turbo run build` (with `--affected` on PRs)                        | Placeholder `DATABASE_URL` for SvelteKit build |
| `migration`        | `db:check` + psql apply loop + structure verification + drift check | Postgres service container                     |
| `container-images` | Docker build, reviewer self-check, and injected-port boot smoke     | Requires GitHub Actions Docker daemon          |
| `ci-status`        | Aggregates all job results; fails if any job failed or cancelled    | Branch protection checks this single job       |

Change detection uses Turborepo's `--affected` flag (dependency-graph-aware) for `check`, `lint`, and `build`. The `test-browser` job uses inline `git diff` checks against the PR base so browser and E2E work only runs when relevant files change. On pushes to `main`, the gated browser job always runs.

The `migration` job applies every numbered SQL file in `packages/database/drizzle/` against a Postgres service container, verifies the resulting schema structure (table count and applied-file-count vs. the journal), and replays historical rename/missing-table scenarios to guard against regressions in migration ordering. It finishes with a drift check (`bun run --cwd packages/database check:migrations`) that fails if the committed migrations diverge from the schema definitions.

The `container-images` job builds the web, engine, proxy, and reviewer images. The reviewer image runs `runner/verify-image.mjs`, which checks system binaries and imports the runtime packages used by `runner/run-agent.mjs` (`@anthropic-ai/claude-agent-sdk` and `@tribunal/agents`) before an agent run can fail later from a missing package.

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
| Turbo `--affected`          | CI         | Limits `check`, `lint`, and `build` to packages affected by the PR's changes      |
| Inline `git diff` detection | CI         | Skips browser/E2E work when no relevant files change                              |
