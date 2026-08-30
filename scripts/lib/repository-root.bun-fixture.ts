// Run by `repository-root.test.ts` through Bun, which is the only runtime that
// populates `import.meta.dir`. Exits non-zero on failure so the caller can
// assert on the exit code rather than parse output.
//
// The markers are deliberately ones that exist ONLY at the repository root. A
// `package.json` check alone was not discriminating: every workspace has one,
// so resolving to `scripts/` instead of the root still satisfied it, and the
// assertion passed against a helper regressed by a whole directory level.
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { resolveRepositoryRoot } from './repository-root';

const root = resolveRepositoryRoot();
for (const marker of ['package.json', 'packages/database', 'applications/web', 'turbo.json']) {
  if (!existsSync(join(root, marker))) {
    console.error(`resolveRepositoryRoot() returned ${root}, which has no ${marker}`);
    process.exit(1);
  }
}
