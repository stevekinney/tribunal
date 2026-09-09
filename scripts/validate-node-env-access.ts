import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { findNodeEnvDotAccess } from './lib/node-env-access-validation';

/**
 * Fails if `process.env.NODE_ENV` dot-access appears anywhere in the web
 * server's shipped source (TRI-44 AC3). See `lib/node-env-access-validation.ts`
 * for why the dot form is banned and the bracket form is not.
 *
 * The scan covers `applications/web/src` and `applications/web/test`. The
 * production entrypoint imports `$testing/end-to-end/handle` from the latter, so
 * that directory ships in the server bundle and a fold-hazard read there would
 * otherwise escape the gate.
 */
const repositoryRoot = join(import.meta.dirname, '..');
const SCANNED_EXTENSIONS = ['.ts', '.tsx', '.js', '.svelte'];
const SCANNED_DIRECTORIES = ['applications/web/src', 'applications/web/test'];

// Enumerate every tracked file under the web source directories and filter by
// extension in code rather than by a `**/*.ext` pathspec: git's `**/` requires
// at least one intermediate directory, so a glob would silently omit root-level
// files such as `hooks.server.ts` — the most likely home for environment logic.
const trackedSourcesResult = Bun.spawnSync({
  cmd: ['git', 'ls-files', '--', ...SCANNED_DIRECTORIES],
  cwd: repositoryRoot,
  stdout: 'pipe',
  stderr: 'inherit',
  timeout: 10_000,
  killSignal: 'SIGKILL',
});

if (trackedSourcesResult.exitCode !== 0) {
  throw new Error('Failed to enumerate web sources.');
}

const filePaths = trackedSourcesResult.stdout
  .toString()
  .trim()
  .split('\n')
  .filter((filePath) => filePath.length > 0)
  .filter((filePath) => SCANNED_EXTENSIONS.some((extension) => filePath.endsWith(extension)));

const violations = (
  await Promise.all(
    filePaths.map(async (filePath) =>
      findNodeEnvDotAccess(await readFile(join(repositoryRoot, filePath), 'utf8'), filePath),
    ),
  )
).flat();

if (violations.length > 0) {
  console.error('NODE_ENV dot-access validation failed:');
  for (const violation of violations) console.error(`- ${violation}`);
  process.exitCode = 1;
} else {
  console.log(`NODE_ENV dot-access validation passed (${filePaths.length} files).`);
}
