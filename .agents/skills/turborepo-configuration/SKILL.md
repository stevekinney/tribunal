---
name: turborepo-configuration
description: Apply Turborepo cache-correctness rules when editing turbo.json, task definitions, workspace build scripts, or CI caching — and prove any gate fails before trusting it to pass.
allowed-tools:
  - Bash
  - Read
  - Grep
  - Glob
  - Edit
  - Write
---

# Turborepo Configuration

## When to use

- Editing root `turbo.json` or any package-level `turbo.json`
- Adding a workspace package, or changing a package's `build` script or output directory
- Adding, renaming, or scoping a task (`build`, `check`, `test`, `lint`, `format`)
- Changing which environment variables tasks receive
- Editing CI caching, checkout depth, or `--affected` usage
- Adding or modifying any gate (coverage threshold, lint scope, format check, CI conditional)

## Constraints

- Follow `{baseDir}/rules/turborepo.md`
- Follow `{baseDir}/rules/github-actions.md` for workflow edits
- Run `bun run validate:turbo` before committing; it also runs in CI and pre-commit

## Key patterns

- `outputs` must cover every directory the build command writes; a cache hit restores only what is declared, so a wrong glob yields a green task and no artifact.
- Derive the expected output directory from the build tool — `tsc` `outDir`, `bun build --outdir`, or the SvelteKit adapter in `svelte.config.js` — never from memory.
- `globalEnv` hashes a value into every task and partitions the cache per value; credentials and connection strings belong in `globalPassThroughEnv` unless inlined at build time (`$env/static/private`, not `$env/dynamic/private`).
- Root-level files belong to no package, so package-scoped tasks never see them; cover `.github/**`, root Markdown, and `documentation/**` with a `//#` root task wired via `dependsOn`.
- Root config files that govern every package (`.prettierrc`, `.prettierignore`, `.oxlintrc.json`) must appear in `globalDependencies` or edits bust no hash.
- Tasks that rewrite files in place (`format`) must set `cache: false`; a cache hit skips the rewrite.
- `--affected` requires `fetch-depth: 0`; on a shallow clone it silently runs everything. Never place a repository-wide gate behind it — invoke those directly.

## Verification

Turborepo failures look like success, so verify by observation rather than by reading configuration.

- **Cache round-trip** — populate the cache, delete the output directory, re-run, and confirm the artifact returns. A `>>> FULL TURBO` line alone proves nothing.
- **Hash sensitivity** — change an input that should matter and confirm the task hash changes (`turbo run <task> --dry=json | jq '.tasks[0].hash'`).
- **Negative test before trusting a gate** — break something the gate claims to cover, confirm it goes red, restore, confirm it goes green. A gate that cannot see a file reports the same green as one that checked and found nothing.

State in the pull request which negative test you ran and what it produced.
