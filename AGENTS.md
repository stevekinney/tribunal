# AGENTS

This is the canonical instruction file for Codex in this repository.

## What this repository is

Tribunal is an automated code-review service. It runs as three deployed applications plus shared packages, all namespaced `@tribunal/*`:

- `applications/web` — SvelteKit (adapter-node). Public UI, `/api/*` routes, GitHub webhook receiver.
- `applications/engine` — a Bun service running Weft workflows, orchestrating Tensorlake reviewer sandboxes, and posting reviews back to GitHub.
- `applications/proxy` — a Bun service providing the signed egress boundary for reviewer sandboxes.

Sign-in is Neon Auth with GitHub as the identity provider. Repository access is a GitHub App installation; a separate GitHub OAuth connection (`oauth_connection`) holds per-user tokens. The core path is: user → GitHub installation → repository → pull request → review run.

Beyond GitHub, the service depends on Neon Postgres, Redis, Tensorlake, and the Anthropic Claude Agent SDK. Do not treat GitHub as the only integration when scoping work.

## Scope and precedence

- Keep this file concise and actionable.
- Put deep implementation detail in domain docs and rules; link to them from here.
- If another instruction file conflicts with this one, follow this file for Codex behavior.

## Core agreements

- Use Bun for all installs and scripts (`bun install`, `bun run <script>`).
- Never run `bun test` directly. Use repository scripts (for example `bun run --cwd applications/web test:unit:server`, `bun run --cwd applications/web test:unit:client`).
- For non-watch test execution, use `vitest run` (not plain `vitest`).
- Prefer explicit full-word naming in prose, identifiers, and filenames when reasonable (for example `configuration`, `utilities`, `repository`, `pull request`).
- Prefer deterministic comparisons (`<`, `>`, exact key ordering helpers) over locale-aware string sorting in runtime logic.
- Avoid adding legacy compatibility layers or migration shims. Prefer updating call sites and removing duplication.
- Keep pull request title and body aligned with the real diff scope.
- Follow existing conventions in `.claude/rules/**` and `.claude/skills/**` before introducing new patterns.
- No Tailwind. Use Cinder primitives from `@lostgradient/cinder`, the base Cinder stylesheet from `@lostgradient/cinder/styles` (component entrypoints auto-import their own CSS), and scoped app styles layered after Cinder where needed.
- For Svelte component work, validate with Svelte MCP autofixer before finalizing changes.

## Execution workflow

- Discover first, then edit. Reuse existing patterns.
- For non-trivial work: research, plan, implement, verify.
- Keep diffs scoped to the user request. Do not change unrelated files.
- Ask clarifying questions only when ambiguity blocks correct implementation.
- When compiling review feedback, record learnings in `documentation/learnings/` and update relevant rules.
- Periodically promote accumulated review learnings with `learning-maintenance` so durable guidance lands in docs and processed learning files are removed.

## Verification standards

- Run the smallest relevant verification set for touched areas before finishing.
- Prefer repository scripts over ad-hoc command variants.
- If tests import a package directly, declare it in that workspace `devDependencies`.
- In pre-commit or orchestration scripts, enforce explicit subprocess timeouts and terminate hung child processes when a timeout is exceeded.

## CI and webhook guardrails

- In strict shell steps (`set -euo pipefail`), guard expected-zero `grep` calls with `|| true` before fallback checks.
- For diagnostic scans that use `grep` (timeouts and log parsing), prefer case-insensitive matching unless normalization is guaranteed.
- GitHub webhook deliveries are claimed idempotently (`INSERT ... ON CONFLICT DO NOTHING`) before processing; preserve that single-claim guarantee so a redelivered event is not processed twice.
- Await critical webhook side effects (signature verification, delivery claim, and event persistence) before returning from handlers.

## Documentation hygiene

- Verify documented paths and symbol names against current code before merge.
- Remove stale references as soon as modules or exports move.
- When documenting coverage, state exact script path and scope. Do not overstate coverage for adjacent packages.
- Do not commit agent artifacts or worktree outputs (for example `.agents/**` files or `.worktree-run.json`) unless explicitly required.

## Where to look first

- `documentation/GETTING_STARTED.md`
- `documentation/ARCHITECTURE.md`
- `documentation/TESTING.md`
- `applications/web/src/lib/README.md`
