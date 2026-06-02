---
paths:
  - scripts/**
---

## Console output

Use **chalk** via `scripts/lib/colors.ts` for styling. Do not use raw ANSI codes.

## Bun script invocation

When spawning Bun subprocesses for package.json scripts, use `bun run <script-name>`.

## CLI flag logic

When `--skip-*` flags are set, use the actual current state (branch, paths) instead of generated values.

## Phase handling

In multi-phase scripts, stop downstream phases when earlier phases fail.

Avoid returning success from a phase before completing its remaining steps (e.g., after pre-commit fixes, still run the push logic; include cost metadata in the final result instead of returning early).

When a phase fails, ensure phase progress status is set to `failed` (not `in-progress`) and preserve the captured error details for diagnostics.

If prompt generation for any section fails, emit a warning in the output and include the failure in the overall status (do not silently proceed as success).

## Agent SDK limits + external updates

When adding CLI flags for `maxTurns`/`maxBudgetUsd`, thread them into the SDK calls that actually execute the model; don't leave flags unused.

If a session ends without a `success` result, treat it as failed and **do not** write external updates (e.g., Linear ticket description updates).

When running model fallback chains, fail fast on non-`model not found` errors (rate limits, network timeouts) to avoid cascading retries that increase cost and latency.

## Input validation

Validate numeric CLI args/env vars before use (reject NaN/out-of-range). When parsing integer IDs, validate the raw string with `/^\d+$/` before `parseInt`—`parseInt('12abc', 10)` silently returns `12`, which can cause the wrong record to be modified.

Reuse shared parsing utilities (`parsePositiveInteger`, etc.) instead of duplicating regex/parse logic across scripts.

For CLI values that represent counts/limits, treat `0` or negative values as invalid instead of silently coercing them.

## Safety regexes

When blocking commands, match both long and short flags (e.g., `--force` and `-f`).

## User-specific values

Never hardcode usernames/paths; use env vars or config.

## ANSI detection

Avoid control characters in regexes; use `String.fromCharCode(0x1b)` when needed.

## Optional operations

Differentiate expected failures (404/422) from unexpected errors; log unexpected ones.

## External CLI dependencies

When a script shells out to optional tools (like `rg`), check availability first
(e.g., `Bun.which('rg')`) and fall back gracefully instead of throwing. CI
runners may not have developer tools installed.

## File change detection

If tool-level tracking shows no changes, check `git status --porcelain` to catch bash edits.

## Variable scoping

Declare variables in outer scope when data computed inside conditionals is needed later (e.g., `let gitChangedFiles: string[] = []` before the `if` block).

## Defensive typing for error handlers

Type variables used in catch blocks as `Type | undefined` even if assignment seems guaranteed; add null checks in error paths.

## Environment variable validation

Create helper functions for env var parsing (e.g., `getMaxTurnsFromEnv()`) to centralize validation and provide clear error messages.

## Preserve intentional defaults when refactoring

When extracting shared helpers (e.g., `getMaxTurnsFromEnv()`), pass the original default as a parameter if call sites had different intentional values (e.g., `getMaxTurnsFromEnv(30)` for focused tasks vs `getMaxTurnsFromEnv(100)` for full implementations).

## Markdown code fences with dynamic content

When embedding dynamic content (logs, user input) in markdown code fences, use a helper that calculates the fence length dynamically to avoid breaking when content contains backticks.

## Artifact persistence on all code paths

When recording phase artifacts (e.g., `.claude-artifacts.json`), ensure artifacts are written on **all** exit paths including early returns and failure branches. Lost artifacts make debugging impossible.

## Summary status reflects actual outcomes

Never hardcode `success: true` in finalization or summary artifacts. Derive success from actual phase results (e.g., `prResult.success && cleanupResult?.success`) so automation and debugging tools get accurate data.

## Include all phase results in status computation and display

When computing workflow status through a dedicated function, include all optional phase results (e.g., `reviewResult`, `cleanupResult`) as parameters. Using phase results only for ancillary purposes like cost tracking while omitting them from status computation causes silent failures—the workflow can report success when a phase actually failed.

Additionally, ensure the user-facing status display lists **every phase** that affects the computed status. If a phase influences whether the workflow is `'success'` or `'partial'`, it must appear in the final status output so users can diagnose failures.

## Path containment checks

When checking if a file path is within a directory, don't use simple `startsWith()` on the string. This incorrectly matches sibling directories with common prefixes (e.g., `/test/data2` matches `/test/data`). Instead:

1. Check for exact path equality
2. Append a path separator before using `startsWith()`: `path.startsWith(base + sep)`
3. Handle root directory edge cases (`/` or `C:\`) which already end with a separator

## Avoid shadowing imported functions

When declaring local variables, avoid names that shadow imported functions (e.g., don't use `const success = ...` when `success()` is imported from a utility module). This causes Temporal Dead Zone (TDZ) errors at runtime because JavaScript hoists the variable declaration, making earlier references to the function fail. Use descriptive names like `verificationSuccess` or `operationSuccess` instead.

## Remove unreachable code paths

When control flow makes certain states impossible (e.g., throwing before a status computation), remove dead branches rather than leaving misleading code. Add a brief comment explaining why the removed case is unreachable if it's non-obvious.

## Pre-compute context for error handlers

When a value needed by error handlers (e.g., file paths for failure recording) is computed mid-phase, pre-compute it **before** the phase starts so catch blocks can access it even if the phase fails partway through. Example: compute the artifact output path before calling `phaseSetup()` so setup failures after the run begins can still record failure context.

## Normalize paths when pre-computing for error handlers

When pre-computing paths for error handlers, use `resolve()` to normalize to absolute paths. Helper functions often return relative paths (e.g., `./artifacts/run-123`) but downstream code may normalize to absolute. Pre-computing the absolute path ensures consistency between the value available in catch blocks and the value used by the code that succeeded.

## Wrap error handler helpers in try-catch

Functions called from catch blocks (like `recordFailure`) should wrap their logic in try-catch to prevent errors from masking the original failure. If metadata can't be written, the original error is more important to surface. Silently ignoring secondary failures ensures users see the root cause.

## Agent SDK tool configuration

When configuring `allowedTools` and `disallowedTools` for the Claude Agent SDK:

1. **Use official SDK tool names** - Check `@anthropic-ai/claude-agent-sdk/sdk-tools.d.ts` for correct names. For example, use `TaskOutput` (not `BashOutput`) to retrieve output from background bash commands.
2. **Document tool purposes** - Add inline comments explaining non-obvious tool choices (e.g., why `TaskOutput` is allowed while `Task` is blocked).
3. **Lists pass through unchanged** - `buildSDKOptions` passes both lists directly to the SDK; the SDK itself handles conflicts where `disallowedTools` takes precedence.

## Resolve threads only after validation passes

When auto-applying changes (e.g., PR suggestions), only resolve the corresponding review threads **after** validation passes (e.g., CI succeeds). Resolving threads before validation means:

1. If validation fails, threads are already resolved, so the next iteration finds no comments
2. The workflow reports success despite validation failure
3. The "retry" logic never gets invoked because there's nothing to retry

Pattern: track validation status with a flag (e.g., `let ciPassed = true`), then only resolve threads inside an `if (ciPassed)` block. If validation fails, fall through to the agent with the original comments so it can fix the issues.

## Array ordering when selecting representative values

When selecting a "representative" or "first" value from a collection for display purposes (e.g., `firstComment.path` for error messages), don't assume array ordering matches semantic priority. Use `.find()` to explicitly select based on criteria (e.g., first non-null value) rather than relying on `[0]` which may have the wrong value.

## Filter undefined values before object spread

When merging CLI overrides with file-based config, filter out `undefined` values before spreading. In JavaScript, `{ key: undefined }` **overwrites** existing values when spread, unlike missing keys which are skipped:

```typescript
// WRONG: undefined values overwrite file config
const merged = { ...fileConfig, ...cliOverrides };

// CORRECT: filter undefined values first
const filtered = Object.fromEntries(
  Object.entries(cliOverrides).filter(([, v]) => v !== undefined),
);
const merged = { ...fileConfig, ...filtered };
```

This is critical when CLI parsers return `undefined` for unprovided flags—the undefined values would otherwise clobber valid config from the file.

## Thread config values through all phases

When adding configuration fields that affect multiple phases (e.g., `maxBudgetUsd`, `defaultBranch`), ensure every function that needs the value receives the config object. Don't pass individual options when a config struct exists—pass the entire config to maintain a single source of truth. This prevents silent bugs where config file values are parsed but never used because intermediate functions only receive CLI options.

## Setup orchestration event parity

When refactoring terminal/event adapters, preserve existing operator-visible failure signals (for example prompt-generation failure warnings and denied `PreToolUse` hook warnings). Silent regressions in phase telemetry make workflow failures harder to diagnose.

If setup emits a lifecycle pair (`setup-start` / `setup-complete`), terminal rendering must handle both events explicitly.

For normalized phase-progress events, never emit `in-progress` for known failures. Use `failed` (or a status derived from the child failure classification) and let retry/failure events represent lifecycle transitions.

## CI readiness checks in automation loops

When phase success depends on CI, do not classify a single `pending` status as immediate failure. Poll with bounded timeout/backoff (or use shared wait helpers) before returning failure, otherwise setup can exhaust retries in normal CI startup windows.

## Handle inline comments in minimal parsers

When writing minimal parsers (e.g., TOML, INI), handle inline comments after values. For quoted strings, find the actual closing quote rather than checking if the line ends with a quote—`"value" # comment` ends with `t`, not `"`. Extract the value first, then parse its type.

## Avoid duplicate package.json scripts

When adding new npm scripts, check for existing scripts with similar or identical functionality before adding new ones. Script duplication creates maintenance burden and can lead to inconsistent updates. Follow these guidelines:

1. **Search before adding** - Use `grep` or search in package.json for similar script names or functionality before adding a new script
2. **Follow naming conventions** - If a pattern exists (e.g., `deploy:status`, `deploy:logs` in `applications/workers`), follow it rather than creating a parallel naming scheme
3. **Update documentation references** - When removing duplicate scripts, search the entire codebase (especially `applications/workers/README.md`, `documentation/**`) for references to the old script name and update them to use the canonical script

Example: If `deploy:status` already exists in `applications/workers`, don't add `status` for the same functionality. Use the existing script and update any documentation that refers to alternative names.

## Derive configuration from actual env values

When generating config that depends on other env values (e.g., OAuth redirect URIs that include a port), read the actual value from `.env` (e.g., `VITE_PORT`) rather than hardcoding a default. Custom setups may use different ports, and hardcoded values cause silent mismatches (e.g., OAuth callbacks registered on port 5173 but the server running on 5183).

## Vitest `--changed` flag behavior

Vitest's `--changed` flag compares HEAD against the working tree (files changed since the last commit), NOT staged files. The flag is useful for pre-commit hooks to run only tests that import modified files, but be aware:

- It does not scope to staged files specifically
- If you need staged-only behavior, derive the file list from `git diff --cached` manually

When documenting `--changed` usage, be precise: "files changed since last commit" not "staged files."

## Workers tests use separate vitest config

The main `vite.config.ts` defines `server` and `client` projects. Workers tests require a separate config (`workers/vitest.config.ts`) because:

1. Workers don't use SvelteKit plugins that cause hung processes
2. Workers have their own `node_modules` and aliases

When running workers tests programmatically:

```ts
// WRONG: workers project doesn't exist in main config
['vitest', 'run', '--project', 'workers']

// CORRECT: use dedicated config file
['vitest', 'run', '-c', 'workers/vitest.config.ts']
```

## Pipe buffer deadlock when spawning processes

When spawning a process with piped stdout/stderr, you MUST read from the pipes before awaiting other blocking operations. OS pipe buffers are typically ~64KB; if the spawned process outputs more than that before you read, it blocks waiting to write, causing deadlock.

```ts
// WRONG: deadlock if proc outputs >64KB before workersProc finishes
const proc = Bun.spawn(cmd, { stdio: ['inherit', 'pipe', 'pipe'] });
await workersProc.exited; // Blocks while proc's pipe buffer fills
const output = await readPipes(proc); // Never reached

// CORRECT: run blocking operations BEFORE spawning piped process
await workersProc.exited;
const proc = Bun.spawn(cmd, { stdio: ['inherit', 'pipe', 'pipe'] });
const output = await readPipes(proc);

// ALSO CORRECT: start reading pipes immediately (concurrent)
const proc = Bun.spawn(cmd, { stdio: ['inherit', 'pipe', 'pipe'] });
const outputPromise = readPipes(proc); // Start reading immediately
await workersProc.exited;
const output = await outputPromise;
```

This is especially problematic with verbose reporters that increase output volume.
