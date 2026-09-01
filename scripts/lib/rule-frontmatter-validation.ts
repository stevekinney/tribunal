import { globSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

const CONDITIONAL_PATHS = new Map([
  ['.claude/rules/plan.md', new Set(['PLAN.md', '.claude/plan.md'])],
]);

function extractPaths(markdown: string): string[] {
  const frontmatter = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1];
  if (!frontmatter) return [];

  const pathsSection = frontmatter.match(/(?:^|\n)paths:\s*\n([\s\S]*?)(?=\n[^\s-]|$)/)?.[1];
  if (!pathsSection) return [];

  return pathsSection
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*-\s+(.*?)\s*$/)?.[1])
    .filter((path): path is string => path !== undefined)
    .map((path) => path.replace(/^(?:"(.*)"|'(.*)')$/, '$1$2'));
}

export function validateRuleFrontmatter(repositoryRoot: string): string[] {
  const ruleDirectory = join(repositoryRoot, '.claude/rules');
  const ruleFiles = readdirSync(ruleDirectory)
    .filter((file) => file.endsWith('.md'))
    .sort();
  const errors: string[] = [];

  for (const ruleFile of ruleFiles) {
    const absolutePath = join(ruleDirectory, ruleFile);
    const relativePath = relative(repositoryRoot, absolutePath);
    const paths = extractPaths(readFileSync(absolutePath, 'utf8'));
    const seen = new Set<string>();

    for (const path of paths) {
      if (seen.has(path)) {
        errors.push(`${relativePath}: duplicate path \`${path}\``);
        continue;
      }
      seen.add(path);

      if (CONDITIONAL_PATHS.get(relativePath)?.has(path)) continue;
      if (globSync(path, { cwd: repositoryRoot }).length === 0) {
        errors.push(`${relativePath}: path \`${path}\` matches no files`);
      }
    }
  }

  return errors;
}
