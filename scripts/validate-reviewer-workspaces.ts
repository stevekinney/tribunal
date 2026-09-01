import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { reviewerWorkspaceParityResult } from './lib/reviewer-workspace-parity';

const repositoryRoot = join(import.meta.dirname, '..');

async function expandWorkspacePattern(pattern: string): Promise<string[]> {
  if (!pattern.endsWith('/*')) return [pattern];
  const parent = pattern.slice(0, -2);
  const entries = await readdir(join(repositoryRoot, parent), { withFileTypes: true });
  const workspaces = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const workspace = `${parent}/${entry.name}`;
        try {
          await readFile(join(repositoryRoot, workspace, 'package.json'));
          return workspace;
        } catch {
          return undefined;
        }
      }),
  );
  return workspaces.filter((workspace): workspace is string => workspace !== undefined);
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
