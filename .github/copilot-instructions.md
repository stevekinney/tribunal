# Copilot Instructions

These instructions guide Copilot code review and the Copilot coding agent. For deeper implementation detail, see `AGENTS.md`, `.claude/rules/`, and `.github/instructions/`.

## What this repository is

Tribunal is a SvelteKit web app plus shared packages. The only integration is GitHub: log in with GitHub OAuth, install the GitHub App in your orgs, then browse your repositories and their open pull requests. The data model is flat: user -> GitHub installation -> installation repository -> repository -> pull request. The app is intentionally minimal — there are no AI, chat, editor, sandbox, project, workspace, or workflow-orchestration features.

## Architecture at a Glance

- **Monorepo** (Turborepo): `applications/{web, engine, proxy}` plus `packages/*` (shared libraries), `runner`, and `scripts`. `web` is the SvelteKit surface, `engine` runs Weft workflows and Tensorlake sandboxes, `proxy` handles sandbox egress.
- **Stack**: Svelte 5, SvelteKit, Drizzle ORM, PostgreSQL (Neon), Bun, Redis (cache), Octokit.
- **Path aliases**: `$lib/*` and `$testing` are SvelteKit aliases (web only); `@tribunal/*` resolves cross-workspace packages.
- **Packages**: `@tribunal/agents`, `@tribunal/cost`, `@tribunal/database`, `@tribunal/github`, `@tribunal/review-core`, `@tribunal/sandbox`, `@tribunal/test`, `@tribunal/typescript` — one per directory under `packages/`. The github package also exports cache utilities (`@tribunal/github/cache`) and the error taxonomy (`@tribunal/github/error-taxonomy`).
- **`@tribunal/github`** must stay framework-free: no Svelte, SvelteKit, `$app/*`, or `$env/*` imports. It may depend on `@tribunal/database` and Drizzle.

## Review Checklist

### 1. Avoid re-implementing existing functionality

- Check `@tribunal/github/error-taxonomy` before defining new error classes.
- Check `@tribunal/github` for GitHub domain logic before adding it to the web app.
- Check `@lostgradient/cinder` for an existing UI component before creating one, then `applications/web/src/lib/components` for the few Tribunal-specific ones. A bespoke component needs a reason why no Cinder component, or composition of them, fits.
- Check `$lib/utilities/` and `$lib/server/` for existing helpers.
- Check `packages/` for shared abstractions before duplicating across workspaces.

### 2. Use existing components and abstractions

- There is no shared `Form` component. A form posting to a named page action on the current page is `<form method="POST" action="?/name" use:enhance>`; leave `use:enhance` off GET filter forms, posts to an API endpoint, and deliberate plain cross-route submissions.
- `cn()` from `$lib/utilities/cn` for class merging.
- `cachedRead` from `@tribunal/github/core/github-read-client` for GitHub API reads.
- Error taxonomy from `@tribunal/github/error-taxonomy` (`NonRetryableError`, `RetryableError`, `ValidationError`, and friends).
- Design tokens from `applications/web/src/lib/styles/tokens.css`, plus Cinder's own — no Tailwind.
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
- Tests required for new components, living alongside them. `.svelte.test.ts` runs in the client project (`test:unit:client`); a plain `.test.ts` runs in the server project (`test:unit:server`).
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
