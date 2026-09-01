import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, test } from 'vitest';
import { rmSync } from 'node:fs';

import { validateRuleFrontmatter } from './rule-frontmatter-validation';

const temporaryDirectories: string[] = [];

function createRepository(): string {
  const repositoryRoot = mkdtempSync(join(tmpdir(), 'tribunal-rule-frontmatter-'));
  temporaryDirectories.push(repositoryRoot);
  mkdirSync(join(repositoryRoot, '.claude/rules'), { recursive: true });
  return repositoryRoot;
}

function writeRule(repositoryRoot: string, name: string, paths: string[]): void {
  const pathLines = paths.map((path) => `  - ${JSON.stringify(path)}`).join('\n');
  writeFileSync(
    join(repositoryRoot, '.claude/rules', name),
    `---\npaths:\n${pathLines}\n---\n\n# Rule\n`,
  );
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('validateRuleFrontmatter', () => {
  test('reports unmatched repository-root paths', () => {
    const repositoryRoot = createRepository();
    writeRule(repositoryRoot, 'authentication.md', ['src/lib/auth/**']);

    expect(validateRuleFrontmatter(repositoryRoot)).toEqual([
      '.claude/rules/authentication.md: path `src/lib/auth/**` matches no files',
    ]);
  });

  test('reports duplicate paths within a rule', () => {
    const repositoryRoot = createRepository();
    mkdirSync(join(repositoryRoot, 'applications/web/src/lib/auth'), { recursive: true });
    writeFileSync(join(repositoryRoot, 'applications/web/src/lib/auth/session.ts'), '');
    writeRule(repositoryRoot, 'authentication.md', [
      'applications/web/src/lib/auth/**',
      'applications/web/src/lib/auth/**',
    ]);

    expect(validateRuleFrontmatter(repositoryRoot)).toEqual([
      '.claude/rules/authentication.md: duplicate path `applications/web/src/lib/auth/**`',
    ]);
  });

  test('allows the two plan files that are created on demand', () => {
    const repositoryRoot = createRepository();
    writeRule(repositoryRoot, 'plan.md', ['PLAN.md', '.claude/plan.md']);

    expect(validateRuleFrontmatter(repositoryRoot)).toEqual([]);
  });

  test('accepts distinct paths that each match at least one file', () => {
    const repositoryRoot = createRepository();
    mkdirSync(join(repositoryRoot, 'applications/web/src/routes/login'), { recursive: true });
    writeFileSync(join(repositoryRoot, 'applications/web/src/routes/login/+page.svelte'), '');
    writeRule(repositoryRoot, 'authentication.md', ['applications/web/src/routes/login/**']);

    expect(validateRuleFrontmatter(repositoryRoot)).toEqual([]);
  });
});
