# Copilot Instructions

These instructions guide Copilot code review and the Copilot coding agent. For deeper implementation detail, see `AGENTS.md`, `.claude/rules/`, and `.github/instructions/`.

## What this repository is

Tribunal is a SvelteKit web app plus shared packages. The only integration is GitHub: log in with GitHub OAuth, install the GitHub App in your orgs, then browse your repositories and their open pull requests. The data model is flat: user -> GitHub installation -> installation repository -> repository -> pull request. The app is intentionally minimal — there are no AI, chat, editor, sandbox, project, workspace, or workflow-orchestration features.

## Architecture at a Glance

- **Monorepo** (Turborepo): `applications/web/` (SvelteKit) and `packages/*` (shared libraries). There is no separate workers application.
- **Stack**: Svelte 5, SvelteKit, Drizzle ORM, PostgreSQL (Neon), Bun, Redis (cache), Octokit.
- **Path aliases**: `$lib/*` and `$testing` are SvelteKit aliases (web only); `@tribunal/*` resolves cross-workspace packages.
- **Packages**: `@tribunal/{github, database, markdown, components, typescript, test}`. The github package also exports cache utilities (`@tribunal/github/cache`) and the error taxonomy (`@tribunal/github/error-taxonomy`).
- **`@tribunal/github`** must stay framework-free: no Svelte, SvelteKit, `$app/*`, or `$env/*` imports. It may depend on `@tribunal/database` and Drizzle.

## Review Checklist

### 1. Avoid re-implementing existing functionality

- Check `@tribunal/github/error-taxonomy` before defining new error classes.
- Check `@tribunal/github` for GitHub domain logic before adding it to the web app.
- Check `@tribunal/components` for existing UI components before creating new ones.
- Check `$lib/utilities/` and `$lib/server/` for existing helpers.
- Check `packages/` for shared abstractions before duplicating across workspaces.

### 2. Use existing components and abstractions

- `Form` from `@tribunal/components/form` — never raw `<form>`.
- `cn()` from `@tribunal/components` for class merging.
- `cachedRead` from `@tribunal/github/core/github-read-client` for GitHub API reads.
- Error taxonomy from `@tribunal/github/error-taxonomy` (`NonRetryableError`, `RetryableError`, `ValidationError`, and friends).
- Design tokens from `@tribunal/components` (`packages/components/src/styles/tokens.css`) — no Tailwind.
- `data-*` attributes for component variants (not conditional classes).
- `sanitizeReturnTo()` for redirect URL validation.
- Snippets for component content slots (`children`, `header`, `footer`, `actions`).

### 3. Codebase conventions

- Full words in names: `utilities` not `utils`, `configuration` not `config`, `repository` not `repo`.
- Bun for all package management (never npm/yarn/pnpm).
- Svelte 5 runes: `$state`, `$derived`, `$derived.by()`, `$effect` — not Svelte 4 stores.
- Scoped CSS with design tokens (no Tailwind, no utility classes).
- `.test.ts` for Node tests, `.svelte.test.ts` for browser tests.
- `cleanup()` in `afterEach` for browser tests.
- Tests required for new components in `packages/components/src/` (`.svelte.test.ts` lives alongside the component).
- Export types in `<script lang="ts" module>`, not in the default script block.

### 4. Identify underlying issues

- Flag missing test coverage for new functionality.
- Flag missing error handling in async paths.
- Flag framework imports leaking into `@tribunal/github` (Svelte, SvelteKit, `$app`, `$env`).
- Flag missing cache invalidation when entities are mutated.
- Flag duplicate logic across workspaces that should live in `packages/`.
- Flag missing `onDelete` on foreign key definitions.

### 5. Technology best practices

- **Svelte 5**: no mutations in `$derived`; never `$derived(() => ...)` (creates a function, not a result); use `$derived.by()` for multi-statement logic.
- **PostgreSQL**: `timestamp with time zone`; explicit `onDelete` on foreign keys; no `db.transaction()` with neon-http.
- **GitHub API**: use the `cachedRead` abstraction; only `{ bypass: true }` when fresh data is explicitly required, with a documented reason.
- **GitHub webhooks**: verify the signature, then claim the delivery idempotently (`INSERT ... ON CONFLICT DO NOTHING`) and persist the event before processing; keep handlers idempotent and await critical side effects before returning.

## Build Verification

- `bun run verify` — full local CI (lockfile, type check, format, lint, tests, build, migration consistency).
- `bun run check` — type check.
- `bun run lint` / `bun run format:check`.
- Never run `bun test` directly. Use workspace test scripts (`bun run --cwd applications/web test:unit:server`, `bun run --cwd applications/web test:unit:client`, etc.).

## Deeper Guidance

- `AGENTS.md` — operational execution rules.
- `.claude/rules/` — domain-specific implementation details.
- `.github/instructions/` — path-specific review heuristics.
