---
paths:
  - applications/*/src/**
  - packages/*/src/**
  - runner/**
  - scripts/**
  - applications/web/test/**
  - documentation/**
  - .claude/**
  - .github/**
  - README.md
  - CLAUDE.md
  - GEMINI.md
---

# Naming and structure conventions

## Package manager

- Use **Bun** for all package management: `bun install`, `bun run <script>`, `bun add <package>`.
- Never run `npm`, `yarn`, or `pnpm` — the lockfile is `bun.lock`. See `.cursorrules` for CI implications.
- Before opening or updating a pull request, run a Codex MCP code review and address all requested changes.

## Prefer full words in names

- Avoid short names like `utils`, `config`, `repo`, `pr`, `org`.
- Use full words in directory names, filenames, identifiers, and user-facing text: `utilities`, `configuration`, `repository`, `pullRequest`, `organization`.
- Avoid introducing new abbreviations; keep existing public APIs stable unless doing a focused cleanup.

## Deterministic ordering and shared helpers

- In runtime logic, prefer deterministic comparisons (`<`, `>`, explicit equality checks) over locale-sensitive helpers like `localeCompare`.
- When multiple call sites format or classify the same value (for example budget warnings, boolean flags, pagination math), extract a shared helper and reuse it instead of duplicating near-identical logic.

## Keep modules small and testable

- Prefer small utility functions in focused files with unit tests.
- Avoid creating or extending files beyond ~600 lines; split into smaller modules before they cross that size.
- When extracting shared utilities, place them in `src/lib` so the rest of the app can reuse them.

## Data structure invariants

- **A function name may imply access control it does not implement.** `getRepositoryById` performs an unscoped lookup; its callers are safe only because they call `userCanAccessRepository` separately. On any path where a user or client supplies the identifier, add the check rather than trusting the name. Trusted background consumers resolving from already-verified events owe their own installation or tenant boundary instead.
- **A flag is enforced where the privileged thing is acquired**, not at the outer loop that looks like the entry point. `REVIEWS_ENABLED` is the worked example: the scheduler still runs its drain loop when the flag is false, and the effective gate is `claimNextReviewIntent` returning `null`. An outer-layer check that leaves the inner acquisition ungated reads as coverage and is not.

- When two data structures track the same relationship (e.g., an edge list and a degree map), ensure they agree on idempotency. If one deduplicates, the other must too, or counts will diverge.
- Prefer a single source of truth. If you need both a list and a lookup, derive one from the other rather than populating both independently.
