import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

import { resolveRepositoryRoot } from '../repository-root';

// TRI-34. This suite was a `bun:test` file that no vitest project collected, so
// converting its imports alone left it still not running. Now that `scripts/**`
// is collected it runs under Vitest -- where `import.meta.dir` is undefined,
// because it is a Bun-only extension Vite's module system never populates.
//
// Splitting on the runtime is not enough on its own. Every configured
// invocation of this file is Vitest, so a branch guarded on "running under Bun"
// is *permanently* skipped, and the only assertion left proves that a Bun-only
// helper fails under a runtime it is never used in. That is not a regression
// guard. The real behaviour is exercised by running the helper under Bun in a
// subprocess and asserting on its exit code.
const testDirectory = dirname(fileURLToPath(import.meta.url));

describe('resolveRepositoryRoot from applications/web/scripts/lib', () => {
  test('resolves to the monorepo root when run under Bun', () => {
    const result = spawnSync('bun', [join(testDirectory, 'repository-root.bun-fixture.ts')], {
      encoding: 'utf8',
      timeout: 30_000,
    });
    expect(result.stderr ?? '').toBe('');
    expect(result.status).toBe(0);
  });

  test('throws under Vite/Vitest because import.meta.dir is a Bun-only extension', () => {
    // `resolveRepositoryRoot()` calls `resolve(import.meta.dir, '..', '..', '..', '..')`.
    // Bun populates `import.meta.dir`; Vite never does, so `node:path#resolve`
    // receives `undefined` and throws. This is unmocked behaviour of the real
    // source, and it is why the helper stays Bun-only rather than being quietly
    // rewritten -- fifteen call sites across the repository use
    // `import.meta.dir`, and this one is not special.
    expect(() => resolveRepositoryRoot()).toThrow(TypeError);
  });
});
