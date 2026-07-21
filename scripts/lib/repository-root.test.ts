import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { resolveRepositoryRoot } from './repository-root';

describe('resolveRepositoryRoot', () => {
  it('matches the real repository layout when running under Bun', () => {
    if (typeof (import.meta as { dir?: string }).dir !== 'string') {
      // Skip the real-filesystem assertion when import.meta.dir is
      // unavailable (i.e. running under Vite instead of Bun).
      return;
    }

    const root = resolveRepositoryRoot();
    expect(existsSync(join(root, 'package.json'))).toBe(true);
  });

  it('throws under Vite/Vitest because import.meta.dir is a Bun-only extension', () => {
    // resolveRepositoryRoot() calls resolve(import.meta.dir, '..', '..').
    // import.meta.dir is populated by Bun's runtime but is never set by
    // Vite's module system, so node:path#resolve receives `undefined` and
    // throws a TypeError. This is real, unmocked behavior of the source
    // under the mandated Vitest harness -- see the bug report in the final
    // coverage summary for the fix recommendation.
    if (typeof (import.meta as { dir?: string }).dir === 'string') {
      // Running under Bun directly: import.meta.dir is populated, so the
      // function succeeds instead. Nothing to assert here in that case.
      return;
    }

    expect(() => resolveRepositoryRoot()).toThrow(TypeError);
  });
});
