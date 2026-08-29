import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { resolveRepositoryRoot } from './repository-root';

// A deadline without `killSignal` is not a deadline. `spawnSync`'s `timeout`
// sends its default signal and then *waits* for the child, so a process that
// traps or ignores SIGTERM runs past the budget — measured in this repository
// at 4019ms against 400ms. `.claude/rules/scripts.md` states the rule; this is
// the check that makes it hold, because the rule alone did not.
//
// Two things this test has already got wrong, both recorded because the fix is
// the interesting part:
//
//  1. It named its files. A hand-maintained list is the defect this whole guard
//     exists to remove, and it silently omitted a spawner.
//  2. It then walked the filesystem, which the same rules file forbids: a
//     recursive walk enters ignored directories — a nested worktree under
//     `.worktrees/` — and fails the current repository over a stale copy git
//     would never commit.
//
// The enumeration is git's. It honours `.gitignore` with no skip list to
// maintain, and it sees exactly what would be committed.
const here = dirname(fileURLToPath(import.meta.url));
const root =
  typeof (import.meta as { dir?: string }).dir === 'string'
    ? resolveRepositoryRoot()
    : join(here, '..', '..');

const SOURCE = /\.(ts|tsx|mts|cts|js|mjs|cjs)$/;

const spawnersWithDeadlines = execFileSync('git', ['ls-files', '-z'], {
  cwd: root,
  encoding: 'utf8',
  maxBuffer: 32 * 1024 * 1024,
})
  .split('\0')
  .filter((path) => path.length > 0 && SOURCE.test(path))
  .filter((path) => {
    const source = readFileSync(join(root, path), 'utf8');
    return source.includes('spawnSync') && source.includes('timeout:');
  })
  .sort();

describe('every subprocess deadline is enforceable', () => {
  it('enumerates the spawners rather than trusting a list', () => {
    // Guards against the enumeration silently matching nothing, which would
    // make every assertion below vacuous while still reading as thorough.
    expect(spawnersWithDeadlines.length).toBeGreaterThan(0);
  });

  it.each(spawnersWithDeadlines)('%s pairs timeout with killSignal', (relativePath) => {
    const source = readFileSync(join(root, relativePath), 'utf8');
    expect(source).toContain('timeout:');
    expect(source).toContain("killSignal: 'SIGKILL'");
  });
});
