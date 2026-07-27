---
paths:
  - turbo.json
  - '**/turbo.json'
  - package.json
  - '.github/workflows/**'
  - '.github/actions/**'
---

# Turborepo configuration rules

Every rule here traces to a defect that shipped to `main` and was invisible in
CI, because each one **fails by looking like success**: green checks, cache
hits, `>>> FULL TURBO`. Run `bun run validate:turbo` to check them
mechanically; it is wired into CI and the pre-commit hook.

## Declare every directory the build actually writes

A cache hit does not re-run the command. It restores exactly the paths in
`outputs` and nothing else. If the glob misses a directory the command writes,
the task reports success and produces no artifact — and Turborepo cannot detect
this, because it never compares what you declared against what the command
wrote.

```jsonc
// WRONG: the app uses @sveltejs/adapter-node, which writes build/
{ "outputs": [".svelte-kit/**", ".vercel/**"] }

// CORRECT: .svelte-kit/** holds the svelte-kit sync types that `check` needs,
// build/** holds the deployable
{ "outputs": [".svelte-kit/**", "build/**"] }
```

Derive the expected directory from the build tool, not from memory:

- `tsc` writes `compilerOptions.outDir`
- `bun build --outdir X` writes `X`
- `vite build` under SvelteKit writes whatever the adapter in
  `svelte.config.js` produces (`adapter-node` and `adapter-static` write
  `build/`; only `adapter-vercel` writes `.vercel/`)

**Verify by round-trip, never by reading the config.** Populate the cache,
delete the output directory, re-run, and confirm the artifact comes back:

```bash
rm -rf applications/web/build && bunx turbo run build --filter=@tribunal/web
rm -rf applications/web/build && bunx turbo run build --filter=@tribunal/web
ls applications/web/build/index.js   # must exist after a cache hit
```

## `globalEnv` partitions the cache; `globalPassThroughEnv` does not

`globalEnv` hashes a variable's **value** into every task. A per-developer or
per-environment value therefore gives every distinct value its own disjoint
cache. Use it only for variables genuinely baked into build output.

- `NODE_ENV` belongs in `globalEnv` — it changes what gets built.
- `DATABASE_URL` and anything ending `_KEY`, `_SECRET`, `_TOKEN`, `_PASSWORD`
  belongs in `globalPassThroughEnv` — forwarded to the command, not hashed.

Before moving a variable, confirm it is not inlined at build time. In SvelteKit
that means `$env/static/private`, which Vite substitutes into the bundle;
`$env/dynamic/private` is read at runtime and is safe to pass through.

```bash
grep -rn "env/static/private" applications/web/src   # must be empty
```

## Root-level files belong to no package, so no package task sees them

Turborepo runs tasks per package. `.github/**`, root Markdown, `turbo.json`,
and `documentation/**` are inside no workspace, so a package-scoped
`format:check` never examines them and reports zero violations forever. Cover
them with a `//#` root task and wire it via `dependsOn` so it holds regardless
of how the task is invoked.

Config files that govern every package but live at the root — `.prettierrc`,
`.prettierignore`, `.oxlintrc.json` — must be listed in `globalDependencies`,
or editing them busts no hash and every task returns a stale cache hit.

## Tasks that write files must set `cache: false`

`format` rewrites files in place. A cached `format` is skipped on a hit, so the
files are never rewritten. Read-only counterparts (`format:check`) stay
cacheable.

## `--affected` needs full git history

Turborepo compares `base...head` and requires every commit between them to
exist in the checkout. On a shallow clone it silently falls back to running
everything — safe, but the flag does nothing. Jobs using `--affected` must
check out with `fetch-depth: 0`.

Because `--affected` can genuinely narrow, never put a repository-wide gate
behind it. Invoke such gates directly (`bun run format:check`,
`bun run validate:turbo`) so a PR touching only one package cannot skip them.

## CI cache

With no `TURBO_TOKEN`, remote caching is off and nothing persists between runs
unless the local cache is restored explicitly. `.github/actions/setup` caches
`.turbo/cache` with a job-scoped, per-SHA key — per-SHA because `actions/cache`
only writes when the exact key missed.

## A gate is not trusted until you have watched it fail

This is the discipline behind every rule above. Each of these defects passed CI
for months because a gate that cannot see a problem reports the same green as a
gate that checked and found nothing. **Before trusting any gate — a coverage
threshold, a lint scope, a format check, a CI conditional — break something it
claims to cover and confirm it goes red.** Then fix it and confirm it goes
green. One example, run against the real gate:

```bash
# Negative test: mangle a file the gate claims to cover
sed -i '' '1s/^name: CI$/name:    CI/' .github/workflows/ci.yml
bun run format:check   # must exit 1 and name the file
git checkout .github/workflows/ci.yml
bun run format:check   # must exit 0
```

Before the root task existed, that first command exited **0** with
`13 cached >>> FULL TURBO`. The gate was not lenient; it was blind. Cache hits
make blind spots self-concealing, because a gate that cannot see a file also
cannot be invalidated by it.

When you add or change a gate, state in the pull request which negative test
you ran and what it produced.
