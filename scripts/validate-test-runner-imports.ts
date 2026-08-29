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

import { lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  findBannedImportsForPath,
  isExtensionlessPath,
  isScannableFile,
  looksBinary,
} from './lib/banned-test-runner-imports';
import { resolveRepositoryRoot } from './lib/repository-root';

const repositoryRoot = resolveRepositoryRoot();

/**
 * No path is excluded from this scan.
 *
 * The regex implementation needed an allowlist for its own test file, whose
 * fixtures are necessarily real-looking import syntax — and an allowlist in a
 * check whose purpose is preventing recurrence is a hole in that purpose. The
 * parser removed the need: those fixtures are string literals, which are not
 * imports, so nothing has to be exempted.
 */

/**
 * Whether a repository-relative path is a regular file right now.
 *
 * `git ls-files --others` carries no mode, so the filesystem answers what
 * `--stage` answers for tracked entries. An untracked *symlink* is read through
 * otherwise: following one into an ignored or external file made this
 * always-on gate reject every commit over a banned import stored in no
 * repository blob, with nothing in the failure to explain why.
 */
function isRegularFile(path: string): boolean {
  try {
    return lstatSync(join(repositoryRoot, path)).isFile();
  } catch {
    // Listed between the scan and the read, or otherwise gone.
    return false;
  }
}

/**
 * Paths worth reading. An extension is the usual signal, but a conventional
 * Bun entrypoint like `bin/run-tests` carries none and is identified by its
 * shebang instead — which cannot be known until the contents are in hand, so
 * such paths are admitted here and filtered after reading.
 */
function isCandidatePath(path: string): boolean {
  // Not `|| isExtensionlessPath(path)`. `isScannableFile` already admits a
  // path with no extension -- nothing in its blocklist can match one -- so the
  // disjunction added no entrypoint and instead overrode the basename
  // rejection it now performs, letting `Dockerfile` through to the TypeScript
  // parser. `isExtensionlessPath` still decides whether a binary check applies
  // once the contents are read.
  return isScannableFile(path);
}

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
    // Every git invocation here runs inside a pre-commit hook, so none of them
    // may hang the commit: a filesystem that stops responding or a credential
    // prompt on a misconfigured remote would otherwise block indefinitely,
    // because `spawnSync` has no deadline of its own.
    //
    // Written at the call rather than behind a name because the deadline
    // invariant requires a value it can read, exactly as it does for
    // `killSignal`. The failure below reports the signal rather than repeating
    // the number, so there is nothing here to drift.
    timeout: 30_000,
    // `timeout` alone signals the child and then waits for it to exit, so a
    // child that traps or ignores SIGTERM is not bounded at all. Measured: a
    // TERM-trapping child ran the full 5s against a 500ms timeout, while the
    // same call with SIGKILL returned at 503ms with `signalCode=SIGKILL`. In
    // an always-on pre-commit gate that is the difference between a deadline
    // and a suggestion.
    killSignal: 'SIGKILL',
    stdin: stdin === undefined ? 'ignore' : new TextEncoder().encode(stdin),
  });

  // A timeout kills the child, leaving a null exit code and a signal.
  if (result.exitCode === null) {
    throw new Error(
      `git ${args[0]} did not finish within its deadline (killed with ${result.signalCode ?? 'unknown signal'}).`,
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

    const [mode, blob, stage] = record.slice(0, tabIndex).split(' ');
    const path = record.slice(tabIndex + 1);
    if (!isCandidatePath(path) || blob === undefined) continue;

    // Mode 160000 is a gitlink: a submodule, whose index entry names a commit
    // rather than a blob. Asking `cat-file --batch` for it returns a `commit`
    // object, and a submodule at an extensionless path (`vendor/tool`) is
    // admitted as a candidate by the shebang rule — so without this the batch
    // would carry an object that is not a blob. There is nothing to scan in a
    // gitlink; the submodule's own repository is where its source lives.
    if (mode === '160000') continue;

    // Mode 120000 is a symlink, whose *blob* is the target pathname while a
    // later worktree read follows the link. A candidate-named symlink pointing
    // at JavaScript in an ignored or external location therefore let this
    // always-on gate reject a commit over imports that exist in no committed
    // blob — and, as the sibling scanner found the hard way, a symlink to a
    // directory throws `EISDIR` outright. The link's target is scanned on its
    // own account when it is itself tracked.
    if (mode === '120000') continue;

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
    if (path === '' || !isCandidatePath(path)) continue;
    // `--others` carries no mode, so the filesystem answers the question
    // `--stage` answered for tracked entries. An untracked symlink is read
    // through — following it to an ignored or external file would reject a
    // commit over content stored in no blob, and a link to a directory throws
    // `EISDIR` outright and takes the whole pre-commit gate down with it.
    if (!isRegularFile(path)) continue;
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
    if (sha === undefined || sizeText === undefined) break;

    const size = Number.parseInt(sizeText, 10);
    if (!Number.isFinite(size)) break;

    const bodyStart = headerEnd + 1;
    // Consume every response, but only keep blobs. Aborting on the first
    // non-blob would discard every remaining entry in the batch — one
    // unexpected object type would silently stop the scan partway through
    // and, because the caller treats a missing blob as a bug, fail the whole
    // gate. Skipping past it keeps the parser synchronised.
    if (type === 'blob') {
      contents.set(sha, decoder.decode(output.subarray(bodyStart, bodyStart + size)));
    }
    offset = bodyStart + size + 1;
  }

  return contents;
}

function main(): void {
  const entries = collectSourceEntries();
  const blobContents = readIndexBlobs(
    entries.map((entry) => entry.blob).filter((blob): blob is string => blob !== undefined),
  );

  const failures: string[] = [];
  let scannedCount = 0;

  for (const entry of entries) {
    // Both the staged blob and the working copy are scanned, and the two
    // differ in ways that each matter:
    //
    // - The **index** is what git will commit. With a partially staged file
    //   whose staged version imports the banned runner and whose worktree
    //   version was already corrected, reading only the worktree passes the
    //   pre-commit hook while the banned blob lands in the commit.
    // - The **worktree** is what a developer is actually running. With an
    //   unstaged edit under an unlinted path, reading only the index lets
    //   `bun run verify` report success on a tree that imports the banned
    //   runner right now.
    //
    // Scanning both removes the need for a mode flag, and with it the chance
    // of invoking the check the wrong way for the context.
    const sources: { label: string; contents: string }[] = [];

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
      sources.push({ label: 'staged', contents: staged });
    }

    let worktree: string | undefined;
    try {
      worktree = readFileSync(join(repositoryRoot, entry.path), 'utf-8');
    } catch {
      // Staged deletions and files removed between listing and reading.
      worktree = undefined;
    }
    // Only worth scanning separately when it differs from what is staged.
    if (worktree !== undefined && worktree !== sources[0]?.contents) {
      sources.push({
        label: entry.blob === undefined ? 'untracked' : 'working tree',
        contents: worktree,
      });
    }

    if (sources.length === 0) continue;

    // Extensionless files are parsed unless they are binary. A shebang
    // requirement was the previous filter and excluded a real case:
    // `bun bin/run-tests` executes a file that has no shebang. Parsing the
    // handful of extensionless files this repository has costs nothing, and a
    // parser finds no imports in prose, so `LICENSE` needs no special case.
    if (
      isExtensionlessPath(entry.path) &&
      sources.every((source) => looksBinary(source.contents))
    ) {
      continue;
    }

    scannedCount += 1;

    const reported = new Set<string>();
    for (const source of sources) {
      for (const found of findBannedImportsForPath(entry.path, source.contents)) {
        const key = `${found.line}:${found.form}:${found.text}`;
        if (reported.has(key)) continue;
        reported.add(key);
        failures.push(
          `${entry.path}:${found.line} (${found.form} import, ${source.label}) — ${found.text}`,
        );
      }
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
      'Each finding says whether it came from the staged blob or the working copy; both are scanned, because they are not always the same file.',
    );
    process.exit(1);
  }

  console.log(
    `validate:test-runner-imports passed (${scannedCount} source file(s) scanned, staged and working copies, no bun:test imports).`,
  );
}

main();
