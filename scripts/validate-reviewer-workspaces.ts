import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { reviewerWorkspaceParityResult } from './lib/reviewer-workspace-parity';

const repositoryRoot = join(import.meta.dirname, '..');

async function expandWorkspacePattern(pattern: string): Promise<string[]> {
  const glob = new Bun.Glob(`${pattern}/package.json`);
  return [...glob.scanSync({ cwd: repositoryRoot, onlyFiles: true })].map(dirname).sort();
}

const rootManifest = JSON.parse(await readFile(join(repositoryRoot, 'package.json'), 'utf8')) as {
  workspaces: string[];
};
const declaredWorkspaces = (
  await Promise.all(rootManifest.workspaces.map(expandWorkspacePattern))
).flat();
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
