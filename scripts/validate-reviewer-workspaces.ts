import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { reviewerWorkspaceParityResult } from './lib/reviewer-workspace-parity';

const repositoryRoot = join(import.meta.dirname, '..');

function trackedWorkspaceManifests(patterns: readonly string[]): string[] {
  const trackedManifestResult = Bun.spawnSync({
    cmd: ['git', 'ls-files', '--', ':(glob)**/package.json'],
    cwd: repositoryRoot,
    stdout: 'pipe',
    stderr: 'inherit',
    timeout: 10_000,
    killSignal: 'SIGKILL',
  });

  if (trackedManifestResult.exitCode !== 0) {
    throw new Error('Failed to enumerate tracked workspace manifests.');
  }

  const trackedManifests = trackedManifestResult.stdout
    .toString()
    .trim()
    .split('\n')
    .filter((manifest) => manifest.length > 0);

  return patterns
    .flatMap((pattern) => {
      const glob = new Bun.Glob(`${pattern}/package.json`);
      return trackedManifests.filter((manifest) => glob.match(manifest));
    })
    .sort();
}

const rootManifest = JSON.parse(await readFile(join(repositoryRoot, 'package.json'), 'utf8')) as {
  workspaces: string[];
};
const workspaceManifests = trackedWorkspaceManifests(rootManifest.workspaces);

if (process.argv.includes('--print-manifests')) {
  for (const manifest of workspaceManifests) console.log(manifest);
  process.exit(0);
}

const declaredWorkspaces = workspaceManifests.map(dirname);
const dockerfile = await readFile(
  join(repositoryRoot, 'deployment/containers/reviewer.Dockerfile'),
  'utf8',
);
const result = reviewerWorkspaceParityResult(declaredWorkspaces, dockerfile);

if (result.exitCode === 1) {
  for (const diagnostic of result.diagnostics) console.error(diagnostic);
  process.exitCode = result.exitCode;
} else {
  console.log(
    `Reviewer Dockerfile workspace parity passed (${declaredWorkspaces.length} workspaces).`,
  );
}
