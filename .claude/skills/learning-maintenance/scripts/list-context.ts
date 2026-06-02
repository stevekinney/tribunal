/**
 * Lists pending learning markdown files and documentation targets.
 *
 * Bundled with the learning-maintenance skill to keep the workflow encapsulated.
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { isIncludedPath } from '../../shared/path-filter.js';

const REVIEW_LEARNINGS_DIRECTORY_RELATIVE_PATH = 'documentation/learnings';
const ROOT_DOCUMENTS = ['AGENTS.md', 'CLAUDE.md', 'README.md'] as const;
const CANONICAL_DOMAIN_SKILLS = [
  'component-standards',
  'database-operations',
  'github-integration-rules',
  'markdown-security',
] as const;

function toSortedUniquePaths(paths: Iterable<string>): string[] {
  return [...new Set(paths)].sort((leftPath, rightPath) => leftPath.localeCompare(rightPath));
}

async function scanGlob(pattern: string, cwd: string): Promise<string[]> {
  const glob = new Bun.Glob(pattern);
  const paths = await Array.fromAsync(glob.scan({ cwd, dot: true, onlyFiles: true }));
  return toSortedUniquePaths(paths);
}

function printPathSection(title: string, paths: string[]): void {
  console.log(`${title} (${paths.length}):`);
  if (paths.length === 0) {
    console.log('- (none)');
    return;
  }

  for (const path of paths) {
    console.log(`- ${path}`);
  }
}

async function main(): Promise<void> {
  const repositoryRoot = process.cwd();
  const learningsDirectoryPath = resolve(repositoryRoot, REVIEW_LEARNINGS_DIRECTORY_RELATIVE_PATH);

  const pendingLearningFiles = existsSync(learningsDirectoryPath)
    ? await scanGlob(`${REVIEW_LEARNINGS_DIRECTORY_RELATIVE_PATH}/**/*.md`, repositoryRoot)
    : [];

  const [skillDocuments, ruleDocuments, readmeDocuments] = await Promise.all([
    scanGlob('.claude/skills/**/SKILL.md', repositoryRoot),
    scanGlob('.claude/rules/*.md', repositoryRoot),
    scanGlob('**/README.md', repositoryRoot),
  ]);
  const canonicalSkills = CANONICAL_DOMAIN_SKILLS.filter((skillName) =>
    existsSync(resolve(repositoryRoot, `.claude/skills/${skillName}/SKILL.md`)),
  );

  const rootDocuments = ROOT_DOCUMENTS.filter((path) => existsSync(resolve(repositoryRoot, path)));
  const includedReadmeDocuments = toSortedUniquePaths(readmeDocuments.filter(isIncludedPath));

  console.log('# Learning maintenance context');
  console.log('');

  printPathSection('Pending learning markdown files', pendingLearningFiles);

  console.log('');
  console.log('Documentation targets:');
  console.log(`- Canonical domain skills (${canonicalSkills.length}): ${canonicalSkills.join(', ')}`);
  console.log(`- Skills: .claude/skills/**/SKILL.md (${skillDocuments.length} files)`);
  console.log(`- Rules: .claude/rules/*.md (${ruleDocuments.length} files)`);
  console.log(`- Root docs: ${rootDocuments.join(', ')}`);
  console.log('');

  printPathSection('README.md targets', includedReadmeDocuments);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
