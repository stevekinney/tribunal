import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { resolveRepositoryRoot } from './repository-root';

// A deadline without `killSignal` is not a deadline. `spawnSync`'s `timeout`
// sends its default signal and then *waits* for the child, so a process that
// traps or ignores SIGTERM runs past the budget — measured in this repository
// at 4019ms against 400ms. `.claude/rules/scripts.md` states the rule; this is
// the check that makes it hold, because the rule alone did not: both Bun
// fixture runners were written with `timeout` and no `killSignal`.
const here = dirname(fileURLToPath(import.meta.url));
const root =
  typeof (import.meta as { dir?: string }).dir === 'string'
    ? resolveRepositoryRoot()
    : join(here, '..', '..');

const SPAWNERS = [
  'scripts/lib/repository-root.test.ts',
  'applications/web/scripts/lib/__tests__/repository-root.test.ts',
];

describe('every subprocess deadline is enforceable', () => {
  it.each(SPAWNERS)('%s pairs timeout with killSignal', (relative) => {
    const source = readFileSync(join(root, relative), 'utf8');
    expect(source).toContain('timeout:');
    expect(source).toContain("killSignal: 'SIGKILL'");
  });
});
