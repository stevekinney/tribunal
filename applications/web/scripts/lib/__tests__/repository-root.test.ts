import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

import { resolveRepositoryRoot } from '../repository-root';

// TRI-34. This suite was a `bun:test` file that no vitest project collected, so
// converting its imports alone left it still not running. Now that `scripts/**`
// is collected it runs under Vitest -- where `import.meta.dir` is undefined,
// because it is a Bun-only extension Vite's module system never populates.
//
// The dual-runtime split is not invented here: `scripts/lib/repository-root.test.ts`
// already established it for the identical helper one directory up. It is spelled
// with `runIf` rather than that file's early `return`, because this workspace sets
// `expect: { requireAssertions: true }`, under which a test that returns before
// asserting fails rather than passing vacuously. Skipping states the same thing
// honestly and satisfies the convention.
const runningUnderBun = typeof (import.meta as { dir?: string }).dir === 'string';

describe('resolveRepositoryRoot from applications/web/scripts/lib', () => {
  test.runIf(runningUnderBun)('resolves to the monorepo root', () => {
    // The three original assertions, preserved verbatim -- they need the Bun
    // runtime to mean anything, not a different subject.
    const root = resolveRepositoryRoot();
    expect(existsSync(join(root, 'package.json'))).toBe(true);
    expect(existsSync(join(root, 'packages/database'))).toBe(true);
    expect(existsSync(join(root, 'applications/web'))).toBe(true);
  });

  test.runIf(!runningUnderBun)(
    'throws under Vite/Vitest because import.meta.dir is a Bun-only extension',
    () => {
      // `resolveRepositoryRoot()` calls `resolve(import.meta.dir, '..', '..', '..', '..')`.
      // Bun populates `import.meta.dir`; Vite never does, so `node:path#resolve`
      // receives `undefined` and throws. This is unmocked behaviour of the real
      // source under the mandated harness, and it is why the helper stays Bun-only
      // rather than being quietly rewritten -- fifteen call sites across the
      // repository use `import.meta.dir`, and this one is not special.
      expect(() => resolveRepositoryRoot()).toThrow(TypeError);
    },
  );
});
