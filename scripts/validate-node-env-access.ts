import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { findNodeEnvDotAccess } from './lib/node-env-access-validation';

/**
 * Fails if `process.env.NODE_ENV` dot-access appears anywhere under
 * `applications/web/src` (TRI-44 AC3). See `lib/node-env-access-validation.ts`
 * for why the dot form is banned and the bracket form is not.
 */
const repositoryRoot = join(import.meta.dirname, '..');
const webSourceGlob = 'applications/web/src/**/*';

const trackedSourcesResult = Bun.spawnSync({
  cmd: [
    'git',
    'ls-files',
    '--',
    `${webSourceGlob}.ts`,
    `${webSourceGlob}.tsx`,
    `${webSourceGlob}.js`,
    `${webSourceGlob}.svelte`,
  ],
  cwd: repositoryRoot,
  stdout: 'pipe',
  stderr: 'inherit',
  timeout: 10_000,
  killSignal: 'SIGKILL',
});

if (trackedSourcesResult.exitCode !== 0) {
  throw new Error('Failed to enumerate applications/web/src sources.');
}

const filePaths = trackedSourcesResult.stdout
  .toString()
  .trim()
  .split('\n')
  .filter((filePath) => filePath.length > 0);

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
