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

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { findBannedTestRunnerImports, isScannableFile } from './lib/banned-test-runner-imports';
import { resolveRepositoryRoot } from './lib/repository-root';

const repositoryRoot = resolveRepositoryRoot();

/**
 * Every git invocation here runs inside a pre-commit hook, so none of them may
 * hang the commit. A stalled child (a filesystem that stops responding, a
 * credential prompt on a misconfigured remote) would otherwise block
 * indefinitely, because `spawnSync` has no deadline of its own.
 */
const GIT_TIMEOUT_MS = 30_000;

/** The only excluded path — see the comment on FIXTURE_FILE below. */
const FIXTURE_FILE = join('scripts', 'lib', 'banned-test-runner-imports.test.ts');

type SourceEntry = {
  /** Repository-relative path, as git reports it. */
  path: string;
  /**
   * The blob this path will contribute to the commit, when it is tracked.
   * Undefined for an untracked file, which has no index entry and must be read
   * from disk.
   */
  blob?: string;
};

function runGit(args: string[], stdin?: string): Buffer {
  const result = Bun.spawnSync(['git', ...args], {
    cwd: repositoryRoot,
    timeout: GIT_TIMEOUT_MS,
    stdin: stdin === undefined ? 'ignore' : new TextEncoder().encode(stdin),
  });

  // A timeout kills the child, leaving a null exit code and a signal.
  if (result.exitCode === null) {
    throw new Error(
      `git ${args[0]} did not finish within ${GIT_TIMEOUT_MS}ms (killed with ${result.signalCode ?? 'unknown signal'}).`,
    );
  }
  if (result.exitCode !== 0) {
    const stderr = new TextDecoder().decode(result.stderr).trim();
    throw new Error(
      `git ${args[0]} failed (exit ${result.exitCode})${stderr ? `: ${stderr}` : ''}`,
    );
  }

  return Buffer.from(result.stdout);
}

/**
 * Enumerate candidate files through git rather than by walking the tree.
 *
 * Walking descends into whatever happens to be on disk, including gitignored
 * local artifacts — `.tmp/`, a stale `.worktrees/` checkout, a scratch copy of
 * the repository. Because the pre-commit hook is deliberately unscoped, a
 * banned fixture in one of those would reject unrelated commits while CI
 * stayed green from a clean checkout, and a nested worktree would make every
 * scan traverse a duplicate repository.
 *
 * Tracked entries carry their **index** blob, not their worktree path alone.
 * That distinction is the whole point: with a partially staged file whose
 * staged version imports the banned runner and whose worktree version has
 * already been corrected, reading the worktree would pass the hook while git
 * committed the banned blob — the gate green on precisely the commit that
 * reintroduces what it exists to stop.
 *
 * Untracked-but-not-ignored files have no index entry and are read from disk,
 * so a newly written file is still caught before it is ever committed.
 */
function collectSourceEntries(): SourceEntry[] {
  const entries = new Map<string, SourceEntry>();

  // `<mode> <sha> <stage>\t<path>\0`
  for (const record of runGit(['ls-files', '--stage', '-z']).toString('utf8').split('\0')) {
    if (record === '') continue;
    const tabIndex = record.indexOf('\t');
    if (tabIndex === -1) continue;

    const [, blob, stage] = record.slice(0, tabIndex).split(' ');
    const path = record.slice(tabIndex + 1);
    if (!isScannableFile(path) || blob === undefined) continue;

    // Stage 0 is the ordinary, unconflicted entry. During a merge conflict a
    // path instead has stages 1-3; taking the first seen would arbitrarily
    // pick one side, so a conflicted path falls through to a worktree read
    // (which is what the developer is actually resolving).
    if (stage === '0') entries.set(path, { path, blob });
    else if (!entries.has(path)) entries.set(path, { path });
  }

  for (const path of runGit(['ls-files', '--others', '--exclude-standard', '-z'])
    .toString('utf8')
    .split('\0')) {
    if (path === '' || !isScannableFile(path)) continue;
    if (!entries.has(path)) entries.set(path, { path });
  }

  // Sorted so a failure report is byte-identical across platforms and
  // filesystems, whose traversal order is not guaranteed.
  return [...entries.values()].sort((first, second) =>
    first.path < second.path ? -1 : first.path > second.path ? 1 : 0,
  );
}

/**
 * Read every index blob in one `git cat-file --batch` process.
 *
 * One spawn per file would be correct and unusably slow at ~700 files. The
 * batch format is `<sha> <type> <size>\n<contents>\n`, and contents are sliced
 * by the declared byte length rather than split on newlines, so a blob
 * containing the delimiter cannot desynchronise the parse.
 */
function readIndexBlobs(blobs: readonly string[]): Map<string, string> {
  const contents = new Map<string, string>();
  if (blobs.length === 0) return contents;

  const output = runGit(['cat-file', '--batch'], `${blobs.join('\n')}\n`);
  const decoder = new TextDecoder();
  let offset = 0;

  while (offset < output.length) {
    const headerEnd = output.indexOf(0x0a, offset);
    if (headerEnd === -1) break;

    const [sha, type, sizeText] = decoder.decode(output.subarray(offset, headerEnd)).split(' ');
    if (sha === undefined || type !== 'blob' || sizeText === undefined) break;

    const size = Number.parseInt(sizeText, 10);
    if (!Number.isFinite(size)) break;

    const bodyStart = headerEnd + 1;
    contents.set(sha, decoder.decode(output.subarray(bodyStart, bodyStart + size)));
    offset = bodyStart + size + 1;
  }

  return contents;
}

function main(): void {
  const entries = collectSourceEntries().filter((entry) => entry.path !== FIXTURE_FILE);
  const blobContents = readIndexBlobs(
    entries.map((entry) => entry.blob).filter((blob): blob is string => blob !== undefined),
  );

  const failures: string[] = [];
  let scannedCount = 0;

  for (const entry of entries) {
    let contents: string;
    if (entry.blob !== undefined) {
      const staged = blobContents.get(entry.blob);
      // A tracked path whose blob git would not hand back is a real problem
      // with this check, not a clean file. Failing loudly beats reporting a
      // pass nobody can trust.
      if (staged === undefined) {
        console.error(
          `validate:test-runner-imports could not read the staged blob for ${entry.path}. That is a bug in this check, not a passing file.`,
        );
        process.exit(1);
      }
      contents = staged;
    } else {
      try {
        contents = readFileSync(join(repositoryRoot, entry.path), 'utf-8');
      } catch {
        // An untracked path can disappear between listing and reading.
        continue;
      }
    }

    scannedCount += 1;

    for (const found of findBannedTestRunnerImports(contents)) {
      failures.push(`${entry.path}:${found.line} (${found.form} import) — ${found.text}`);
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
    console.error(
      'Tracked files are read from the git index, so a staged import is reported even when the working copy has already been corrected.',
    );
    process.exit(1);
  }

  console.log(
    `validate:test-runner-imports passed (${scannedCount} source file(s) scanned from the index, no bun:test imports).`,
  );
}

main();
