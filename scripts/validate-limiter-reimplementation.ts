import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { findLimiterReimplementation } from './lib/limiter-reimplementation-validation';

/**
 * Fails if the MCP rate limiter's Redis Lua tokens appear in Tribunal's own
 * source (TRI-56 AC1). The limiting logic is the library's; Tribunal supplies
 * only storage and configuration. See `lib/limiter-reimplementation-validation.ts`.
 *
 * Scans `applications/web/src` and `packages`, excluding test/spec files (a test
 * that references a token as a fixture is not a reimplementation) and this
 * scanner's own fixtures under `scripts/`, which `git ls-files` for these
 * directories does not enumerate. `node_modules` — where the library's Lua
 * legitimately lives — is untracked and never scanned.
 */
const repositoryRoot = join(import.meta.dirname, '..');
const SCANNED_EXTENSIONS = ['.ts', '.tsx', '.svelte'];
const SCANNED_DIRECTORIES = ['applications/web/src', 'packages'];

const trackedSourcesResult = Bun.spawnSync({
  cmd: ['git', 'ls-files', '--', ...SCANNED_DIRECTORIES],
  cwd: repositoryRoot,
  stdout: 'pipe',
  stderr: 'inherit',
  timeout: 10_000,
  killSignal: 'SIGKILL',
});

if (trackedSourcesResult.exitCode !== 0) {
  throw new Error('Failed to enumerate Tribunal sources.');
}

const filePaths = trackedSourcesResult.stdout
  .toString()
  .trim()
  .split('\n')
  .filter((filePath) => filePath.length > 0)
  .filter((filePath) => SCANNED_EXTENSIONS.some((extension) => filePath.endsWith(extension)))
  .filter((filePath) => !/\.(test|spec)\.ts$/.test(filePath));

const violations = (
  await Promise.all(
    filePaths.map(async (filePath) =>
      findLimiterReimplementation(await readFile(join(repositoryRoot, filePath), 'utf8'), filePath),
    ),
  )
).flat();

if (violations.length > 0) {
  console.error('Rate-limiter reimplementation validation failed (Redis Lua tokens in source):');
  for (const violation of violations) console.error(`- ${violation}`);
  process.exitCode = 1;
} else {
  console.log(`Rate-limiter reimplementation validation passed (${filePaths.length} files).`);
}
