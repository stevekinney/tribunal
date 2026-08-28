import { describe, expect, it } from 'vitest';

import { findBannedTestRunnerImports, isScannableFile } from './banned-test-runner-imports';

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
    expect(findBannedTestRunnerImports("import 'bun:test';\n")).toHaveLength(1);
  });

  it('catches a re-export', () => {
    const found = findBannedTestRunnerImports("export { test } from 'bun:test';\n");
    expect(found).toHaveLength(1);
    expect(found[0]?.form).toBe('static');
  });

  /**
   * Regression for the review finding on this branch. The first version
   * anchored the import body on `[^;\n]`, which stops at the first newline —
   * so the multiline form a formatter routinely produces passed straight
   * through the backstop, in exactly the unlinted paths it exists to cover.
   */
  it('catches a multiline static import, as a formatter would write it', () => {
    const contents = ['import {', '  describe,', '  test,', "} from 'bun:test';"].join('\n');
    const found = findBannedTestRunnerImports(contents);
    expect(found).toHaveLength(1);
    expect(found[0]?.form).toBe('static');
    expect(found[0]?.line).toBe(1);
    // The report must stay on one line even when the import spans four.
    expect(found[0]?.text).not.toContain('\n');
  });

  it('catches a multiline re-export', () => {
    const contents = ['export {', '  test,', "} from 'bun:test';"].join('\n');
    expect(findBannedTestRunnerImports(contents)).toHaveLength(1);
  });

  /**
   * `import/*c* /('bun:test')` is valid JavaScript. A matcher permitting only
   * whitespace between tokens is bypassed by it, which is disqualifying for a
   * check whose whole claim is that it cannot be bypassed.
   */
  it('catches an import with a block comment between the tokens', () => {
    expect(findBannedTestRunnerImports("import/* sneaky */('bun:test')")).toHaveLength(1);
    expect(findBannedTestRunnerImports("require/* sneaky */('bun:test')")).toHaveLength(1);
    expect(findBannedTestRunnerImports("import(/* sneaky */ 'bun:test')")).toHaveLength(1);
  });

  /**
   * The form plain ESLint's `no-restricted-imports` cannot see. oxlint 1.78
   * does flag it, so this matters for the eslint-only `scripts/` workspace and
   * for every unlinted path.
   */
  it('catches a dynamic import, which plain ESLint cannot see', () => {
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
   * Ordering must not depend on the runtime locale — the same two findings
   * would otherwise be reported in a different order locally than in CI.
   * `AGENTS.md` requires deterministic comparisons for exactly this reason.
   */
  it('orders two findings on the same line deterministically', () => {
    const contents = "const a = require('bun:test'); const b = await import('bun:test');";
    const first = findBannedTestRunnerImports(contents).map((entry) => entry.text);
    const second = findBannedTestRunnerImports(contents).map((entry) => entry.text);
    expect(first).toEqual(second);
    expect(first).toHaveLength(2);
    expect([...first].sort()).toEqual(first);
  });

  /**
   * Two findings whose text is byte-identical, on the same line. The
   * tie-breaker has to return "equal" here rather than picking an arbitrary
   * winner, or the report order would depend on the sort's internal
   * comparison order for equal elements.
   */
  it('treats two identical findings on one line as equal, without reordering them', () => {
    const contents = "const a = require('bun:test'); const b = require('bun:test');";
    const found = findBannedTestRunnerImports(contents);
    expect(found).toHaveLength(2);
    expect(found[0]?.text).toBe(found[1]?.text);
    expect(found.map((entry) => entry.line)).toEqual([1, 1]);
    // Stable across repeated scans, which is the property the tie-break exists
    // to provide.
    expect(findBannedTestRunnerImports(contents)).toEqual(found);
  });

  it('reports a match once, not once per overlapping pattern', () => {
    expect(findBannedTestRunnerImports("import 'bun:test';")).toHaveLength(1);
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
   * ban, a false positive someone can see and rephrase beats a false negative
   * nobody ever learns about.
   *
   * The cost is that this file's own fixtures look like violations, which is
   * why `validate-test-runner-imports.ts` excludes exactly this path.
   */
  it('reports import syntax inside a comment, failing closed', () => {
    expect(findBannedTestRunnerImports("// never import from 'bun:test' here")).toHaveLength(1);
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

  it('does not let a static import run past its own statement into another', () => {
    // The preceding statement is terminated, so the `import` keyword on line 1
    // cannot reach the specifier on line 2.
    const contents = ["import { readFile } from 'node:fs';", 'const x = 1;'].join('\n');
    expect(findBannedTestRunnerImports(contents)).toEqual([]);
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

  it('accepts a nested path, since git reports paths rather than basenames', () => {
    expect(isScannableFile('runner/run-agent.test.mjs')).toBe(true);
    expect(isScannableFile('.github/scripts/audit-workflows.ts')).toBe(true);
  });
});
