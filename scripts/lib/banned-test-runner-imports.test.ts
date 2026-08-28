import { describe, expect, it } from 'vitest';

import {
  findBannedTestRunnerImports,
  isIgnoredPath,
  isScannableFile,
} from './banned-test-runner-imports';

describe('findBannedTestRunnerImports', () => {
  it('catches a named static import', () => {
    const found = findBannedTestRunnerImports("import { describe, test } from 'bun:test';\n");
    expect(found).toHaveLength(1);
    expect(found[0]?.form).toBe('static');
    expect(found[0]?.line).toBe(1);
  });

  it('catches a type-only import, which still names the runner', () => {
    const found = findBannedTestRunnerImports("import type { Mock } from 'bun:test';\n");
    expect(found).toHaveLength(1);
    expect(found[0]?.form).toBe('static');
  });

  it('catches a bare side-effect import', () => {
    const found = findBannedTestRunnerImports("import 'bun:test';\n");
    expect(found).toHaveLength(1);
  });

  it('catches a re-export', () => {
    const found = findBannedTestRunnerImports("export { test } from 'bun:test';\n");
    expect(found).toHaveLength(1);
    expect(found[0]?.form).toBe('static');
  });

  /**
   * The reason this module exists alongside the lint rule.
   * `no-restricted-imports` matches static import and export declarations
   * only, so this form reports nothing at all under eslint or oxlint —
   * verified against the installed configuration during review.
   */
  it('catches a dynamic import, which no-restricted-imports cannot see', () => {
    const found = findBannedTestRunnerImports("const t = await import('bun:test');\n");
    expect(found).toHaveLength(1);
    expect(found[0]?.form).toBe('dynamic');
  });

  it('catches a require call', () => {
    const found = findBannedTestRunnerImports("const t = require('bun:test');\n");
    expect(found).toHaveLength(1);
    expect(found[0]?.form).toBe('require');
  });

  it('tolerates double quotes and irregular whitespace', () => {
    expect(findBannedTestRunnerImports('import ( "bun:test" )')).toHaveLength(1);
    expect(findBannedTestRunnerImports('require(  "bun:test"  )')).toHaveLength(1);
  });

  it('reports the correct line for an import below the first line', () => {
    const contents = ["'use strict';", '', "import { test } from 'bun:test';"].join('\n');
    expect(findBannedTestRunnerImports(contents)[0]?.line).toBe(3);
  });

  it('reports every occurrence in one file, in line order', () => {
    const contents = [
      "import { test } from 'bun:test';",
      "const later = await import('bun:test');",
    ].join('\n');
    const found = findBannedTestRunnerImports(contents);
    expect(found.map((entry) => entry.line)).toEqual([1, 2]);
    expect(found.map((entry) => entry.form)).toEqual(['static', 'dynamic']);
  });

  /**
   * The rule's own definition in `.oxlintrc.json` names the specifier as a
   * configuration value. A check that flagged the configuration declaring it
   * would be unusable, so the patterns match import syntax rather than the
   * bare specifier.
   */
  it('does not flag the specifier appearing as a configuration value', () => {
    expect(findBannedTestRunnerImports("{ name: 'bun:test', message: 'Use vitest.' }")).toEqual([]);
    expect(findBannedTestRunnerImports("const specifier = 'bun:test';")).toEqual([]);
  });

  /**
   * Import syntax inside a comment IS reported, deliberately. Stripping
   * comments before matching is the obvious alternative and it is worse: a
   * `//` inside a string (a URL, most commonly) would truncate the rest of
   * the line, so a real import sharing that line would go unreported. For a
   * ban, a false positive someone can see and rephrase beats a false
   * negative nobody ever learns about.
   *
   * The cost is that this file's own fixtures below look like violations,
   * which is why `validate-test-runner-imports.ts` excludes exactly this
   * path and no other.
   */
  it('reports import syntax inside a comment, failing closed', () => {
    const found = findBannedTestRunnerImports("// never import from 'bun:test' here");
    expect(found).toHaveLength(1);
  });

  it('does not flag an identifier that merely ends in a keyword', () => {
    expect(findBannedTestRunnerImports("myimport('bun:test')")).toEqual([]);
    expect(findBannedTestRunnerImports("options.require('bun:test')")).toEqual([]);
  });

  it('does not flag vitest imports', () => {
    expect(findBannedTestRunnerImports("import { describe } from 'vitest';")).toEqual([]);
  });

  it('does not flag a different bun builtin', () => {
    expect(findBannedTestRunnerImports("import { file } from 'bun:jsc';")).toEqual([]);
  });

  it('returns an empty array for empty input rather than throwing', () => {
    expect(findBannedTestRunnerImports('')).toEqual([]);
  });

  /**
   * The patterns are module-scope globals carrying `lastIndex`. Without an
   * explicit reset, scanning a second file would resume partway through and
   * silently miss an import near the top of it.
   */
  it('finds the same import on repeated scans, so regex state does not leak', () => {
    const contents = "import { test } from 'bun:test';\n";
    expect(findBannedTestRunnerImports(contents)).toHaveLength(1);
    expect(findBannedTestRunnerImports(contents)).toHaveLength(1);
    expect(findBannedTestRunnerImports(contents)).toHaveLength(1);
  });
});

describe('isScannableFile', () => {
  it('accepts every extension that can carry a module import', () => {
    for (const name of [
      'a.ts',
      'a.tsx',
      'a.mts',
      'a.cts',
      'a.js',
      'a.jsx',
      'a.mjs',
      'a.cjs',
      'a.svelte',
    ]) {
      expect(isScannableFile(name)).toBe(true);
    }
  });

  it('rejects files that cannot contain an import', () => {
    for (const name of ['a.json', 'a.md', 'a.sql', 'a.svg', 'README']) {
      expect(isScannableFile(name)).toBe(false);
    }
  });
});

describe('isIgnoredPath', () => {
  it('ignores dependency and build-output directories', () => {
    expect(isIgnoredPath(['packages', 'database', 'node_modules', 'x.ts'])).toBe(true);
    expect(isIgnoredPath(['applications', 'web', 'dist', 'x.js'])).toBe(true);
    expect(isIgnoredPath(['applications', 'web', '.svelte-kit', 'x.js'])).toBe(true);
  });

  it('does not ignore a real source path', () => {
    expect(isIgnoredPath(['runner', 'run-agent.test.mjs'])).toBe(false);
    expect(isIgnoredPath(['.github', 'scripts', 'audit-workflows.ts'])).toBe(false);
  });

  it('matches whole segments, not substrings', () => {
    // `distribution/` is not `dist/`, and must still be scanned.
    expect(isIgnoredPath(['packages', 'distribution', 'x.ts'])).toBe(false);
  });
});
