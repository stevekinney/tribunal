import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { selectParentBranch } from '../neon-branch';

const currentDirectory = dirname(fileURLToPath(import.meta.url));

/** Resolve a path relative to the database package root (three levels up from __tests__). */
function packageRoot(...segments: string[]): string {
  return resolve(currentDirectory, '../../..', ...segments);
}

async function readPackageJson(): Promise<Record<string, unknown>> {
  const filePath = packageRoot('package.json');
  const content = await readFile(filePath, 'utf-8');
  return JSON.parse(content) as Record<string, unknown>;
}

async function readRepositoryFile(...segments: string[]): Promise<string> {
  return readFile(packageRoot('../..', ...segments), 'utf-8');
}

describe('CI workflow validation', () => {
  describe('Neon migration parent branch selection', () => {
    const branches = [
      { id: 'br-preview', name: 'preview/pr-143', primary: false },
      { id: 'br-production', name: 'production', primary: true },
    ];

    it('uses the project primary branch by default', () => {
      expect(selectParentBranch(branches)).toEqual(branches[1]);
    });

    it('uses an explicitly configured branch name', () => {
      expect(selectParentBranch(branches, 'preview/pr-143')).toEqual(branches[0]);
    });

    it('accepts an explicitly configured branch identifier', () => {
      expect(selectParentBranch(branches, 'br-manual')).toEqual({
        id: 'br-manual',
        name: 'br-manual',
        primary: false,
      });
    });

    it('rejects a missing configured branch', () => {
      expect(() => selectParentBranch(branches, 'missing')).toThrow(
        'Parent branch "missing" not found',
      );
    });

    it('rejects projects without a primary branch when no branch is configured', () => {
      expect(() =>
        selectParentBranch(branches.map((branch) => ({ ...branch, primary: false }))),
      ).toThrow('Primary branch not found');
    });
  });

  describe('production deploy workflow', () => {
    it('records reviewer build context and image sizes in the step summary', async () => {
      const workflow = await readRepositoryFile('.github/workflows/deploy-production.yml');

      expect(workflow).toContain('du -sb "$REVIEWER_IMAGE_CONTEXT"');
      expect(workflow).toContain("docker image inspect --format '{{.Size}}'");
      expect(workflow).toContain('Reviewer build context size');
      expect(workflow).toContain('Reviewer image size');
    });
  });

  describe('package.json scripts', () => {
    let packageJson: Record<string, any>;

    async function getPackageJson(): Promise<Record<string, any>> {
      if (!packageJson) {
        packageJson = await readPackageJson();
      }
      return packageJson;
    }

    it('has db:test-migrations script pointing to run-migration-tests', async () => {
      const json = await getPackageJson();
      const scripts = json.scripts as Record<string, string>;
      expect(scripts['db:test-migrations']).toBeDefined();
      expect(scripts['db:test-migrations']).toContain('run-migration-tests');
    });

    it('has db:validate-invariants script pointing to validate-invariants', async () => {
      const json = await getPackageJson();
      const scripts = json.scripts as Record<string, string>;
      expect(scripts['db:validate-invariants']).toBeDefined();
      expect(scripts['db:validate-invariants']).toContain('validate-invariants');
    });

    it('has db:detect-drift script pointing to detect-drift', async () => {
      const json = await getPackageJson();
      const scripts = json.scripts as Record<string, string>;
      expect(scripts['db:detect-drift']).toBeDefined();
      expect(scripts['db:detect-drift']).toContain('detect-drift');
    });

    it('has a vitest-based test script', async () => {
      const json = await getPackageJson();
      const scripts = json.scripts as Record<string, string>;
      expect(scripts['test']).toBeDefined();
      expect(scripts['test']).toContain('vitest');
    });
  });

  describe('run-migration-tests.ts structure', () => {
    let content: string;

    async function getContent(): Promise<string> {
      if (!content) {
        const filePath = packageRoot('src/test/run-migration-tests.ts');
        content = await readFile(filePath, 'utf-8');
      }
      return content;
    }

    it('imports from validate-invariants and neon-branch', async () => {
      const text = await getContent();
      expect(text).toContain("from './neon-branch'");
      expect(text).toContain("from './validate-invariants'");
    });

    it('validates NEON_PROJECT_ID environment variable', async () => {
      const text = await getContent();
      expect(text).toContain('NEON_PROJECT_ID');
    });

    it('validates NEON_API_KEY environment variable', async () => {
      const text = await getContent();
      expect(text).toContain('NEON_API_KEY');
    });

    it('calls process.exit(1) on failure', async () => {
      const text = await getContent();
      expect(text).toContain('process.exit(1)');
    });

    it('performs cleanup in a finally block', async () => {
      const text = await getContent();
      expect(text).toContain('finally');
      expect(text).toContain('cleanup');
    });

    it('writes test results to a file', async () => {
      const text = await getContent();
      expect(text).toContain('writeTestResults');
      expect(text).toContain('test-results');
    });

    it('uses import.meta.main guard for CLI execution', async () => {
      const text = await getContent();
      expect(text).toContain('import.meta.main');
    });
  });

  describe('detect-drift.ts structure', () => {
    let content: string;

    async function getContent(): Promise<string> {
      if (!content) {
        const filePath = packageRoot('src/test/detect-drift.ts');
        content = await readFile(filePath, 'utf-8');
      }
      return content;
    }

    it('imports EXPECTED_TABLES from validate-invariants', async () => {
      const text = await getContent();
      expect(text).toContain("from './validate-invariants'");
      expect(text).toContain('EXPECTED_TABLES');
    });

    it('exports detectDrift function', async () => {
      const text = await getContent();
      expect(text).toContain('export async function detectDrift');
    });

    it('exports drift-related types', async () => {
      const text = await getContent();
      expect(text).toContain('export type DriftType');
      expect(text).toContain('export type DriftSeverity');
      expect(text).toContain('export interface DriftDetail');
      expect(text).toContain('export interface DriftReport');
      expect(text).toContain('hasCriticalDrift');
      expect(text).toContain('criticalCount');
      expect(text).toContain('warningCount');
    });

    it('checks for missing tables, extra tables, column mismatches, and constraints', async () => {
      const text = await getContent();
      expect(text).toContain('MISSING_TABLE');
      expect(text).toContain('EXTRA_TABLE');
      expect(text).toContain('COLUMN_MISMATCH');
      expect(text).toContain('CONSTRAINT_MISSING');
    });

    it('uses import.meta.main guard for CLI execution', async () => {
      const text = await getContent();
      expect(text).toContain('import.meta.main');
    });

    it('calls process.exit(1) when drift is detected', async () => {
      const text = await getContent();
      expect(text).toContain('process.exit(1)');
    });

    it('exits successfully for warning-only drift', async () => {
      const text = await getContent();
      expect(text).toContain('Drift detection completed with warnings only');
      expect(text).toContain('process.exit(0)');
    });
  });
});
