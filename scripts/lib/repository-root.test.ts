import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { resolveRepositoryRoot } from './repository-root';

const here = dirname(fileURLToPath(import.meta.url));

describe('resolveRepositoryRoot', () => {
  it('matches the real repository layout when run under Bun', () => {
    // Previously this returned early whenever `import.meta.dir` was unset,
    // which is *every* configured run: the suite is executed by Vitest, so the
    // assertion was permanently skipped and the helper's real behaviour was
    // never checked. Running it under Bun in a subprocess is what actually
    // exercises it; the fixture exits non-zero on failure so this asserts on
    // the exit code rather than on parsed output.
    const result = spawnSync('bun', [join(here, 'repository-root.bun-fixture.ts')], {
      encoding: 'utf8',
      timeout: 30_000,
    });
    expect(result.stderr ?? '').toBe('');
    expect(result.status).toBe(0);
  });

  it('throws under Vite/Vitest because import.meta.dir is a Bun-only extension', () => {
    // resolveRepositoryRoot() calls resolve(import.meta.dir, '..', '..').
    // import.meta.dir is populated by Bun's runtime but is never set by
    // Vite's module system, so node:path#resolve receives `undefined` and
    // throws a TypeError. This is real, unmocked behavior of the source
    // under the mandated Vitest harness -- see the bug report in the final
    // coverage summary for the fix recommendation.
    expect(() => resolveRepositoryRoot()).toThrow(TypeError);
  });
});
