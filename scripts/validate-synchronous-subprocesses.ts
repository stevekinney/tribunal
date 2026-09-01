import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { findUnboundedSynchronousSubprocessCalls } from './lib/synchronous-subprocess-validation';

const repositoryRoot = join(import.meta.dirname, '..');
const trackedSourcesResult = Bun.spawnSync({
  cmd: [
    'git',
    'ls-files',
    '--',
    '*.js',
    '*.mjs',
    '*.cjs',
    '*.jsx',
    '*.ts',
    '*.mts',
    '*.cts',
    '*.tsx',
  ],
  cwd: repositoryRoot,
  stdout: 'pipe',
  stderr: 'inherit',
  timeout: 10_000,
  killSignal: 'SIGKILL',
});

if (trackedSourcesResult.exitCode !== 0) {
  throw new Error('Failed to enumerate tracked JavaScript and TypeScript sources.');
}

const filePaths = trackedSourcesResult.stdout
  .toString()
  .trim()
  .split('\n')
  .filter((filePath) => filePath.length > 0);
const violations = (
  await Promise.all(
    filePaths.map(async (filePath) =>
      findUnboundedSynchronousSubprocessCalls(
        await readFile(join(repositoryRoot, filePath), 'utf8'),
        filePath,
      ),
    ),
  )
).flat();

if (violations.length > 0) {
  console.error('Synchronous subprocess deadline validation failed:');
  for (const violation of violations) console.error(`- ${violation}`);
  process.exitCode = 1;
} else {
  console.log(`Synchronous subprocess deadline validation passed (${filePaths.length} files).`);
}
