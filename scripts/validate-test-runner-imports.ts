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
 *   convention cannot promise that, but walking the repository can.
 * - **`no-restricted-imports` cannot see dynamic imports.** It matches static
 *   import and export declarations only, so a dynamic `import(...)` of the
 *   same specifier reports nothing at all under either oxlint or eslint.
 *   Verified against the installed configuration.
 *
 * The lint rule stays: it is what gives immediate feedback in an editor and in
 * the per-package lint run. This is the backstop that makes the guarantee true
 * everywhere rather than only where the convention was followed.
 *
 * All filesystem access lives here; the matching rules are pure functions in
 * `lib/banned-test-runner-imports.ts`, which is covered by the 100% gate.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import {
  findBannedTestRunnerImports,
  isIgnoredPath,
  isScannableFile,
} from './lib/banned-test-runner-imports';
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

function collectSourceFiles(directory: string): string[] {
  const collected: string[] = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = join(directory, entry.name);
    const segments = relative(repositoryRoot, absolutePath).split(sep);

    if (isIgnoredPath(segments)) continue;

    if (entry.isDirectory()) {
      collected.push(...collectSourceFiles(absolutePath));
    } else if (entry.isFile() && isScannableFile(entry.name)) {
      collected.push(absolutePath);
    }
  }

  return collected;
}

function main(): void {
  const sourceFiles = collectSourceFiles(repositoryRoot);
  const failures: string[] = [];
  let scannedCount = 0;

  for (const absolutePath of sourceFiles) {
    const relativePath = relative(repositoryRoot, absolutePath);
    if (relativePath === FIXTURE_FILE) continue;

    scannedCount += 1;

    for (const found of findBannedTestRunnerImports(readFileSync(absolutePath, 'utf-8'))) {
      failures.push(`${relativePath}:${found.line} (${found.form} import) — ${found.text}`);
    }
  }

  // An empty failure list means nothing was found, which is only meaningful if
  // files were actually scanned. A walker that silently matched nothing would
  // otherwise report success identically to a clean repository.
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
