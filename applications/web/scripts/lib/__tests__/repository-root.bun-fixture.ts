// Run by `repository-root.test.ts` through Bun, which is the only runtime that
// populates `import.meta.dir`. Exits non-zero on failure so the caller can
// assert on the exit code rather than parse output.
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { resolveRepositoryRoot } from '../repository-root';

const root = resolveRepositoryRoot();
for (const expected of ['package.json', 'packages/database', 'applications/web']) {
  if (!existsSync(join(root, expected))) {
    console.error(`resolveRepositoryRoot() returned ${root}, which has no ${expected}`);
    process.exit(1);
  }
}
