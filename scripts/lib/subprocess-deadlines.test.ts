import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { resolveRepositoryRoot } from './repository-root';

// A deadline without `killSignal` is not a deadline. `spawnSync`'s `timeout`
// sends its default signal and then *waits* for the child, so a process that
// traps or ignores SIGTERM runs past the budget — measured in this repository
// at 4019ms against 400ms. `.claude/rules/scripts.md` states the rule; this is
// the check that makes it hold, because the rule alone did not.
//
// The cases are DERIVED, not listed. A hand-maintained list is the defect this
// whole guard exists to remove: the first version of this test named two files
// and silently omitted `scripts/validate-test-runner-imports.ts`, which uses a
// deadline of its own — so the test called "every subprocess deadline is
// enforceable" would have stayed green with that file's `killSignal` deleted.
const here = dirname(fileURLToPath(import.meta.url));
const root =
  typeof (import.meta as { dir?: string }).dir === 'string'
    ? resolveRepositoryRoot()
    : join(here, '..', '..');

const SKIP = new Set(['node_modules', '.git', 'dist', 'coverage', '.tmp', '.svelte-kit', 'build']);
const SOURCE = /\.(ts|tsx|mts|cts|js|mjs|cjs)$/;

function sourceFilesUnder(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    if (SKIP.has(entry)) continue;
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      found.push(...sourceFilesUnder(path));
    } else if (SOURCE.test(entry)) {
      found.push(path);
    }
  }
  return found;
}

/** Files that spawn a subprocess with a deadline, whatever they are called. */
const spawnersWithDeadlines = sourceFilesUnder(root)
  .filter((path) => {
    const source = readFileSync(path, 'utf8');
    return source.includes('spawnSync') && source.includes('timeout:');
  })
  .map((path) => relative(root, path))
  .sort();

describe('every subprocess deadline is enforceable', () => {
  it('finds the spawners rather than trusting a list', () => {
    // Guards against the walk silently matching nothing, which would make
    // every assertion below vacuous.
    expect(spawnersWithDeadlines.length).toBeGreaterThan(0);
  });

  it.each(spawnersWithDeadlines)('%s pairs timeout with killSignal', (relativePath) => {
    const source = readFileSync(join(root, relativePath), 'utf8');
    expect(source).toContain('timeout:');
    expect(source).toContain("killSignal: 'SIGKILL'");
  });
});
