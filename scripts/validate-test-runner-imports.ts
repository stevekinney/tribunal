#!/usr/bin/env bun
/**
 * Assert that no `bun:test` import exists anywhere in the repository.
 *
 * Tribunal's test runner is vitest, and `.oxlintrc.json` bans the import via
 * `no-restricted-imports`. This check exists because that rule, correct as it
 * is, cannot deliver the invariant on its own:
 *
 * - **A lint rule only reaches files something lints.** The root `lint` script
 *   is `turbo run lint`, which runs only workspaces declaring a `lint` script.
 *   `runner/` (which contains vitest tests) and `.github/` (which contains
 *   more) declare none, so the rule never sees them — and a workspace added
 *   later that omits the script is silently exempt too. TRI-34 asks for a rule
 *   that applies "repo-wide, including packages added later"; per-workspace
 *   convention cannot promise that, but enumerating the repository can.
 * - **Plain ESLint cannot see dynamic imports.** `no-restricted-imports`
 *   matches static import and export declarations only, so a dynamic
 *   `import(...)` of the same specifier reports nothing under ESLint. This is
 *   an ESLint limitation specifically: oxlint 1.78 *does* flag the dynamic
 *   form, so the eleven oxlint-backed workspaces are already covered. The gap
 *   is the eslint-only `scripts/` workspace plus every unlinted path.
 *
 * The lint rule stays: it is what gives immediate feedback in an editor and in
 * the per-package lint run. This is the backstop that makes the guarantee true
 * everywhere rather than only where the convention was followed.
 *
 * All filesystem access lives here; the matching rules are pure functions in
 * `lib/banned-test-runner-imports.ts`, which is covered by the 100% gate.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { findBannedTestRunnerImports, isScannableFile } from './lib/banned-test-runner-imports';
import { resolveRepositoryRoot } from './lib/repository-root';

const repositoryRoot = resolveRepositoryRoot();

/**
 * The only excluded path, and it is excluded for one specific reason: this is
 * the file that proves the matcher works, so it necessarily contains the
 * import forms the matcher is built to find. Every other file in the
 * repository is scanned. Keeping the list to a single exact path — rather than
 * a glob over test files — means a real violation cannot hide behind it.
 */
const FIXTURE_FILE = join('scripts', 'lib', 'banned-test-runner-imports.test.ts');

/**
 * Enumerate candidate files through git rather than by walking the tree.
 *
 * Walking descends into whatever happens to be on disk, including gitignored
 * local artifacts — `.tmp/`, a stale `.worktrees/` checkout, a scratch copy of
 * the repository. Because the pre-commit hook is deliberately unscoped, a
 * banned fixture sitting in one of those would reject unrelated commits while
 * CI stayed green from a clean checkout, and a nested worktree would make
 * every scan traverse a duplicate repository.
 *
 * `--cached --others --exclude-standard` is exactly the set that matters:
 * everything tracked, plus everything untracked that is *not* ignored, so a
 * newly written file is caught before it is ever committed. Output is sorted
 * so a failure report is byte-identical across platforms and filesystems.
 */
function collectSourceFiles(): string[] {
  const result = Bun.spawnSync(
    ['git', 'ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { cwd: repositoryRoot },
  );

  if (result.exitCode !== 0) {
    const stderr = new TextDecoder().decode(result.stderr).trim();
    throw new Error(`git ls-files failed (exit ${result.exitCode})${stderr ? `: ${stderr}` : ''}`);
  }

  return new TextDecoder()
    .decode(result.stdout)
    .split('\0')
    .filter((path) => path !== '' && isScannableFile(path))
    .sort();
}

function main(): void {
  const relativePaths = collectSourceFiles();
  const failures: string[] = [];
  let scannedCount = 0;

  for (const relativePath of relativePaths) {
    if (relativePath === FIXTURE_FILE) continue;

    const absolutePath = join(repositoryRoot, relativePath);
    // `git ls-files` can name a path that no longer exists on disk (a staged
    // deletion, most commonly). Reading it would throw and look like a check
    // failure rather than a deleted file.
    if (!existsSync(absolutePath)) continue;

    scannedCount += 1;

    for (const found of findBannedTestRunnerImports(readFileSync(absolutePath, 'utf-8'))) {
      failures.push(
        `${relative('.', relativePath)}:${found.line} (${found.form} import) — ${found.text}`,
      );
    }
  }

  // An empty failure list means nothing was found, which is only meaningful if
  // files were actually scanned. A collector that silently returned nothing
  // would otherwise report success identically to a clean repository.
  if (scannedCount === 0) {
    console.error(
      'validate:test-runner-imports found no source files to scan. That is a bug in this check, not a passing repository.',
    );
    process.exit(1);
  }

  if (failures.length > 0) {
    console.error(`Found ${failures.length} banned \`bun:test\` import(s):`);
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    console.error(
      "\nTribunal's test runner is vitest. Import from 'vitest' instead — `describe`, `expect`, `test`, and `it` have the same names, and `mock()`/`spyOn()` become `vi.fn()`/`vi.spyOn()`.",
    );
    process.exit(1);
  }

  console.log(
    `validate:test-runner-imports passed (${scannedCount} source file(s) scanned, no bun:test imports).`,
  );
}

main();
