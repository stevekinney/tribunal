---
paths:
  - .github/workflows/**
---

# GitHub Actions workflow rules

Before editing paths in this rule, load `$github-integration-rules` and apply its constraints.

## Permission principle of least privilege

Grant only the permissions a workflow actually needs. Default to read for informational access, use write only when the action must modify something.

```yaml
permissions:
  contents: read # For checkout
  pull-requests: write # Only if posting comments/reviews
  issues: write # Only if posting issue comments
  actions: read # Only if reading CI results
```

**Common mistakes:**

- Forgetting `id-token: write` when using actions that require OIDC authentication (like `anthropics/claude-code-action`)
- Granting `id-token: write` when not using OIDC authentication
- Using only read permissions when the action needs to post comments (results in 403 errors)
- Forgetting that `pull-requests: write` is needed to post PR review comments

## OIDC authentication for third-party actions

Some GitHub Actions use OpenID Connect (OIDC) to authenticate with external services instead of long-lived secrets. These actions require `id-token: write` permission.

```yaml
permissions:
  id-token: write # Required for OIDC authentication
  contents: read
  pull-requests: write
```

**Actions that require OIDC:**

- `anthropics/claude-code-action` - authenticates with Anthropic infrastructure
- AWS credential actions using OIDC federation
- Azure credential actions using federated identity

**Symptom of missing permission:** The workflow fails with "Unable to get ACTIONS_ID_TOKEN_REQUEST_URL env variable" or similar OIDC token fetch errors.

## Authorization guards for mention-triggered workflows

When workflows trigger on user mentions (like `@claude` or `@bot`), restrict execution to authorized users to prevent abuse:

```yaml
if: |
  (github.event_name == 'issue_comment' &&
    contains(github.event.comment.body, '@bot') &&
    contains(fromJson('["OWNER","MEMBER","COLLABORATOR"]'), github.event.comment.author_association)
  )
```

**Valid author associations:** `OWNER`, `MEMBER`, `COLLABORATOR`, `CONTRIBUTOR`, `FIRST_TIME_CONTRIBUTOR`, `FIRST_TIMER`, `NONE`

For internal repos, typically allow `OWNER`, `MEMBER`, `COLLABORATOR`.

## Bot-triggered Claude reviews

If a PR can be updated by automation (for example, `cursor[bot]`), set `allowed_bots` on `anthropics/claude-code-action` to an explicit allowlist. This prevents the action from failing with "Workflow initiated by non-human actor" while keeping bot scope tight.

## Concurrency control for PR workflows

When workflows trigger on `synchronize` (push to PR), add concurrency to prevent stale runs from completing:

```yaml
concurrency:
  group: workflow-name-${{ github.head_ref || github.ref_name }}
  cancel-in-progress: true
```

Without this, rapid pushes spawn parallel runs that may post outdated feedback.

## Resource optimization

Skip draft PRs for expensive workflows (AI reviews, full test suites):

```yaml
jobs:
  expensive-job:
    if: github.event.pull_request.draft == false
```

Consider filtering by file paths when workflows only matter for certain changes:

```yaml
on:
  pull_request:
    paths:
      - 'src/**/*.ts'
      - 'src/**/*.svelte'
```

## Changed-only inputs

If a job uses changed-only mode via environment variables, ensure the changed file list is populated and scoped to PRs.

```yaml
- name: Compute changed files
  if: github.event_name == 'pull_request'
  run: |
    git fetch origin main --depth=1
    {
      echo 'CHANGED_FILES<<__EOF__'
      git diff --name-only origin/main...HEAD || true
      echo '__EOF__'
    } >> "$GITHUB_ENV"
```

Avoid setting changed-only flags on push-to-main runs unless a full fallback is defined.

## Unused dependencies

Do not install or cache Playwright in jobs that only run unit tests or Vitest suites that stay in the Node environment. If the job runs Vitest browser tests (`vitest/browser`), keep the Playwright install/cache steps.

## Memory limits for Node.js steps

ESLint and other Node.js tools can hit memory limits on GitHub Actions runners (2GB default). When running memory-intensive linting on large codebases, increase the heap size. GitHub Actions `ubuntu-latest` runners have 7GB RAM, so 8GB heap (with swap) is typically safe:

```yaml
- name: Lint
  run: bun run lint
  env:
    NODE_OPTIONS: --max-old-space-size=8192
```

**Symptom:** `FATAL ERROR: Ineffective mark-compacts near heap limit Allocation failed - JavaScript heap out of memory` or `Reached heap limit Allocation failed`

**Note:** 4GB may not be enough for large codebases—this project requires 8GB.

## Playwright caching order

When caching Playwright browsers, the version detection must happen **after** dependency installation. Use `jq` to read the version from `package.json` rather than `bunx playwright --version` (which may use a globally cached version) or `node -p "require(...)"` (which assumes CommonJS module resolution and fails in ESM projects).

**Correct order:**

```yaml
- name: Install dependencies
  run: bun install

- name: Get Playwright version
  id: playwright-version
  working-directory: applications/web
  run: |
    VERSION=$(jq -r .version node_modules/playwright/package.json)
    echo "version=$VERSION" >> "$GITHUB_OUTPUT"

- name: Cache Playwright browsers
  uses: actions/cache@v4
  with:
    path: ~/.cache/ms-playwright
    key: playwright-${{ runner.os }}-${{ steps.playwright-version.outputs.version }}
```

**Symptom of wrong order:** Cache hits restore browsers for the wrong Playwright version, causing "executable doesn't exist" failures at runtime.

## YAML formatting

GitHub Actions YAML files must pass Prettier formatting. Run `bun run format` (writes fixes) and `bun run format:check` (validation) before committing workflow changes.

## Shell strict mode and `grep` exit behavior

In steps that use `set -euo pipefail`, `grep` exits with status `1` when no match is found. This can terminate the step before your explicit fallback logic runs.

```yaml
- name: Verify process groups
  run: |
    set -euo pipefail
    expected_count=$(grep -cE '^[[:space:]]*-[[:space:]]+[[:alnum:]_-]+' fly.toml || true)
    if [ "$expected_count" -eq 0 ]; then
      echo "No process groups found"
      exit 1
    fi
```

Prefer one of:
- Append `|| true` when zero matches are expected and handled explicitly.
- Use a conditional check (`if grep -q ...`) when count output is not required.

## Drizzle migration compatibility checks

When seeding `drizzle.__drizzle_migrations` in CI for compatibility tests, use the `entries[].when` value (millis) from `_journal.json`, not `NOW()`/`EXTRACT(EPOCH...)`. Drizzle decides whether to run a migration via `created_at < journal_entry.when`; using wall-clock time makes every migration look already applied, producing false-positive tests.

```sql
-- WRONG: created_at far exceeds the journal millis, so migrations never run
INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('<migration-sha256-hash-here>', EXTRACT(EPOCH FROM NOW()) * 1000);

-- CORRECT: use entries[].when from packages/database/drizzle/meta/_journal.json
INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('<migration-sha256-hash-here>', 1707990593000);
```

- Compatibility checks that query migration metadata must use schema-qualified table references (for example `drizzle.__drizzle_migrations`) and detect table existence before querying.

## Safe interpolation in workflow scripts

- Never inject raw pull request titles, branch names, or user-provided content directly into shell code.
- For GitHub expression interpolation in script bodies, pass dynamic values through environment variables or `toJson(...)` and parse safely inside the step.
