---
applyTo: '.github/workflows/**,.github/actions/**'
---

# GitHub Actions Review Heuristics

These heuristics reflect Tribunal's actual workflows. CI runs lint, type-check,
unit tests, browser/Storybook tests with Playwright, and database migration
checks. All workflows currently request only `contents: read`; there are no
AI-review or PR-commenting jobs.

## Permissions

- Grant only the permissions a workflow actually needs. Default to `contents: read`.
- Do not add `pull-requests: write`, `id-token: write`, or other elevated scopes
  unless a job genuinely posts comments, authenticates via OIDC, or otherwise
  requires them. No current workflow does.

## Concurrency control

- Add concurrency groups to PR workflows to cancel stale runs. The established
  pattern keys on the branch:

```yaml
concurrency:
  group: workflow-name-${{ github.head_ref || github.ref_name }}
  cancel-in-progress: true
```

## Resource optimization

- Scope work to what changed. CI uses Turbo's `--affected` on pull requests
  (`turbo run check/lint/build ${{ github.event_name == 'pull_request' && '--affected' || '' }}`).
- Gate expensive jobs (Playwright browser tests, Storybook) behind a changed-files
  check so they only run when relevant paths change.
- Do not install Playwright in jobs that only run Node.js unit tests.

## Memory limits

- ESLint and the type checker can hit memory limits on GitHub Actions runners.
  Set `NODE_OPTIONS: --max-old-space-size=...` (CI uses `8192` for the heaviest
  steps, `4096` elsewhere) for memory-intensive steps.

## Shell strict mode and grep

- In `set -euo pipefail` steps, `grep` exits with status 1 when no match is found,
  terminating the step.
- Append `|| true` when zero matches are expected and handled explicitly.
- Use `if grep -q ...` when count output is not required.

## Safe interpolation

- Never inject raw PR titles, branch names, or user-provided content directly into
  shell code.
- Pass dynamic values through environment variables or `toJson(...)` and parse
  inside the step.

## Playwright caching

- Version detection must happen **after** dependency installation, so
  `node_modules/playwright` exists.
- Read the version with `jq -r .version node_modules/playwright/package.json`
  (not `bunx playwright --version`). Cache `~/.cache/ms-playwright` keyed on that
  version. This is what `.github/actions/setup-playwright` does.

## Changed-only mode

- When a job scopes itself to changed files, compute the base via
  `git diff --name-only "$BASE_SHA"...HEAD -- <paths>` and only run when the list
  is non-empty.
- On push-to-`main` runs there is no PR base; treat that branch as "always run"
  (CI sets `changed=true` for `push` events) rather than scoping to a diff.

## YAML formatting

- GitHub Actions YAML must pass Prettier. Run `bun run format:check` before
  committing workflow changes.

## Migration checks

- CI verifies migrations by counting applied SQL files against
  `jq '.entries | length' packages/database/drizzle/meta/_journal.json` — it does
  **not** query `drizzle.__drizzle_migrations` for the count.
- When the migration steps seed `drizzle.__drizzle_migrations`, `created_at` is set
  from `NOW()` (as epoch milliseconds); the journal `entries` array is the source
  of truth for the expected migration count.
