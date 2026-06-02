import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { resolveRepositoryRoot } from '../repository-root';

describe('resolveRepositoryRoot from applications/web/scripts/lib', () => {
  test('resolves to the monorepo root', () => {
    const root = resolveRepositoryRoot();
    expect(existsSync(join(root, 'package.json'))).toBe(true);
    expect(existsSync(join(root, 'packages/database'))).toBe(true);
    expect(existsSync(join(root, 'applications/web'))).toBe(true);
  });
});
