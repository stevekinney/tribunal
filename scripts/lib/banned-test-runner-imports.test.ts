import { describe, expect, it } from 'vitest';

import {
  findBannedImportsForPath,
  findBannedImportsInSvelte,
  findBannedTestRunnerImports,
  isExtensionlessPath,
  isScannableFile,
  looksBinary,
} from './banned-test-runner-imports';

describe('findBannedTestRunnerImports', () => {
  it('catches a named static import', () => {
    const found = findBannedTestRunnerImports("import { describe, test } from 'bun:test';\n");
    expect(found).toHaveLength(1);
    expect(found[0]?.form).toBe('static');
    expect(found[0]?.line).toBe(1);
  });

  it('catches type-only, default, namespace, bare, and re-export forms', () => {
    for (const source of [
      "import type { Mock } from 'bun:test';",
      "import runner from 'bun:test';",
      "import * as runner from 'bun:test';",
      "import 'bun:test';",
      "export { test } from 'bun:test';",
      "export * from 'bun:test';",
    ]) {
      expect(findBannedTestRunnerImports(source), source).toHaveLength(1);
    }
  });

  it('catches dynamic import and require, including the TypeScript equals form', () => {
    expect(findBannedTestRunnerImports("const t = await import('bun:test');")[0]?.form).toBe(
      'dynamic',
    );
    expect(findBannedTestRunnerImports("const t = require('bun:test');")[0]?.form).toBe('require');
    expect(findBannedTestRunnerImports("import t = require('bun:test');")[0]?.form).toBe('require');
  });

  /**
   * Every construct review found against the previous regex implementation,
   * across four rounds. Each one passed the matcher at the time it was found.
   */
  describe('constructs that defeated the regex implementation', () => {
    it('multiline static import, as a formatter writes it', () => {
      const contents = ['import {', '  describe,', '  test,', "} from 'bun:test';"].join('\n');
      const found = findBannedTestRunnerImports(contents);
      expect(found).toHaveLength(1);
      expect(found[0]?.line).toBe(1);
      expect(found[0]?.text).not.toContain('\n');
    });

    it('block comment between tokens', () => {
      expect(findBannedTestRunnerImports("import/* c */('bun:test')")).toHaveLength(1);
      expect(findBannedTestRunnerImports("require/* c */('bun:test')")).toHaveLength(1);
    });

    it('line comment between tokens', () => {
      expect(findBannedTestRunnerImports("await import(// why\n'bun:test');")).toHaveLength(1);
      expect(findBannedTestRunnerImports("import { test } from // why\n'bun:test';")).toHaveLength(
        1,
      );
    });

    it('template-literal specifier', () => {
      expect(findBannedTestRunnerImports('import { test } from `bun:test`;')).toHaveLength(1);
      expect(findBannedTestRunnerImports('const t = await import(`bun:test`);')).toHaveLength(1);
    });

    it('dynamic import with a second options argument', () => {
      const found = findBannedTestRunnerImports(
        "const t = await import('bun:test', { with: { type: 'x' } });",
      );
      expect(found).toHaveLength(1);
      expect(found[0]?.form).toBe('dynamic');
    });

    /**
     * The one that ended the regex approach: `[^;]*?` treats the semicolon
     * inside the comment as the end of the statement, so the import was never
     * seen. No amount of tuning a character class fixes a question about
     * lexical context.
     */
    it('semicolon inside a comment inside a static import', () => {
      expect(
        findBannedTestRunnerImports(
          "import { /* temporary; remove later */ test } from 'bun:test';",
        ),
      ).toHaveLength(1);
    });
  });

  /**
   * The file name is what selects the grammar. Parsed as `.ts`, a JSX element
   * mis-parses and the call expression inside it is simply not in the tree,
   * so an import nested in JSX was invisible in unlinted `.jsx`/`.tsx` files.
   */
  it('parses JSX files with the JSX grammar', () => {
    const jsx = "const view = <div>{import('bun:test')}</div>;";
    expect(findBannedImportsForPath('component.tsx', jsx)).toHaveLength(1);
    expect(findBannedImportsForPath('component.jsx', jsx)).toHaveLength(1);
  });

  it('still parses angle-bracket type assertions in .ts, which .tsx forbids', () => {
    // Guards against "just parse everything as TSX": this is valid TypeScript
    // and would be a syntax error under the JSX grammar.
    expect(
      findBannedImportsForPath('module.ts', "const x = <string>y; import 'bun:test';"),
    ).toHaveLength(1);
  });

  it('catches CommonJS module.require, which Bun honours as a loader', () => {
    expect(findBannedTestRunnerImports("const t = module.require('bun:test');")[0]?.form).toBe(
      'require',
    );
  });

  /**
   * Transparency is a property of the node, not of where it appears. The
   * previous round handled parentheses on the specifier only, leaving them
   * unhandled on the callee and leaving assertions unhandled in both
   * positions.
   */
  it('unwraps every transparent wrapper, in both positions', () => {
    // Around the specifier.
    for (const source of [
      "await import('bun:test' as const);",
      "await import('bun:test' as string);",
      "require('bun:test' as const);",
      "await import(<string>'bun:test');",
      "await import('bun:test' satisfies string);",
      "await import('bun:test'!);",
    ]) {
      expect(findBannedTestRunnerImports(source), source).toHaveLength(1);
    }

    // Around the callee.
    for (const source of [
      "(require)('bun:test');",
      "(module.require)('bun:test');",
      "((require))('bun:test');",
      "(import.meta.require)('bun:test');",
    ]) {
      expect(findBannedTestRunnerImports(source), source).toHaveLength(1);
    }

    // Both at once.
    expect(findBannedTestRunnerImports("(require)(('bun:test') as const);")).toHaveLength(1);
  });

  it('catches computed access to the standard loaders', () => {
    // `module['require']` calls the same function as `module.require`; a
    // predicate that recognises only the dotted spelling is bypassed by
    // writing the other one.
    for (const source of [
      "module['require']('bun:test');",
      'module["require"](\'bun:test\');',
      "import.meta['require']('bun:test');",
    ]) {
      expect(findBannedTestRunnerImports(source), source).toHaveLength(1);
    }
  });

  it('folds constant string concatenation in a specifier', () => {
    expect(findBannedTestRunnerImports("await import('bun:' + 'test');")).toHaveLength(1);
    expect(findBannedTestRunnerImports("require('bun' + ':' + 'test');")).toHaveLength(1);
  });

  it('does not fold a concatenation involving a variable', () => {
    // Not knowable here, and guessing produces findings nobody can act on.
    expect(findBannedTestRunnerImports("await import('bun:' + kind);")).toEqual([]);
  });

  /**
   * Lexical scoping, done properly. `let`/`const`/`class` are block-scoped;
   * `var` and function declarations are function-scoped and hoisted. The two
   * previous attempts at this each got one half right and the other wrong —
   * first descending into nested functions' parameters, then descending into
   * unrelated blocks.
   */
  describe('shadow resolution follows real scoping rules', () => {
    it('a block-scoped binding does not shadow a call outside its block', () => {
      expect(
        findBannedTestRunnerImports("{ const require = custom; }\nrequire('bun:test');"),
      ).toHaveLength(1);
    });

    it('a var in a class static block does not shadow outside it', () => {
      // A static block is its own `var` scope, like a function.
      expect(
        findBannedTestRunnerImports(
          "class C { static { var require = custom; } }\nrequire('bun:test');",
        ),
      ).toHaveLength(1);
    });

    it('a destructured parameter does shadow within its function', () => {
      // `function load({ require })` binds `require` as surely as a plain
      // parameter does; an identifier-only check reported the caller's own
      // function as a loader.
      expect(
        findBannedTestRunnerImports("function load({ require }) { return require('bun:test'); }"),
      ).toEqual([]);
    });

    it('a var in a nested block does shadow, because var hoists', () => {
      expect(
        findBannedTestRunnerImports("{ var require = custom; }\nrequire('bun:test');"),
      ).toEqual([]);
    });

    it('a function declared in a block does not shadow outside it', () => {
      // In a module, a block-scoped function declaration is not hoisted out of
      // its block — verified against Node, where `{ function f(){} } f()`
      // throws ReferenceError. Only `var` hoists.
      expect(
        findBannedTestRunnerImports("{ function require(n) { return n; } }\nrequire('bun:test');"),
      ).toHaveLength(1);
    });

    it('a nested function parameter does not shadow the enclosing scope', () => {
      expect(
        findBannedTestRunnerImports(
          "function helper(require) { return require; }\nrequire('bun:test');",
        ),
      ).toHaveLength(1);
    });

    it('an ambient declaration does not shadow, because it binds nothing', () => {
      // `declare const require: ...` asserts that some runtime binding exists;

      // TypeScript erases it, so treating it as a shadow suppressed a real

      // finding rather than preventing a false one.

      expect(
        findBannedTestRunnerImports(
          "declare const require: (n: string) => unknown;\nrequire('bun:test');",
        ),
      ).toHaveLength(1);
    });

    it('a parameter does shadow within its own function', () => {
      expect(
        findBannedTestRunnerImports("function f(require) { return require('bun:test'); }"),
      ).toEqual([]);
    });
  });

  it('does not report a locally shadowed require or module', () => {
    // These call the file's own code, not a loader, so reporting them would
    // reject a valid commit — and it would contradict the rule that an
    // arbitrary object's `require` method is not a module system.
    expect(
      findBannedTestRunnerImports("function require(name) { return name; }\nrequire('bun:test');"),
    ).toEqual([]);
    expect(
      findBannedTestRunnerImports("function load(module) { return module.require('bun:test'); }"),
    ).toEqual([]);
  });

  it('still reports a genuine loader elsewhere in a file that shadows one', () => {
    // The shadow is scoped to the function, so the top-level call is real.
    // A file-wide approximation would have missed this.
    const contents = [
      'function helper(require) { return require; }',
      "const t = require('bun:test');",
    ].join('\n');
    expect(findBannedTestRunnerImports(contents)).toHaveLength(1);
  });

  it('catches JSDoc type imports, which forEachChild does not traverse', () => {
    expect(
      findBannedTestRunnerImports("/** @type {import('bun:test').Mock} */\nlet m;"),
    ).toHaveLength(1);
  });

  it('still refuses a non-loader callee however it is wrapped', () => {
    expect(findBannedTestRunnerImports("(options.require)('bun:test');")).toEqual([]);
    expect(findBannedTestRunnerImports("(new.target.require)('bun:test');")).toEqual([]);
  });

  it('unwraps parenthesized specifiers, which are semantically transparent', () => {
    expect(findBannedTestRunnerImports("await import(('bun:test'));")).toHaveLength(1);
    expect(findBannedTestRunnerImports("require(('bun:test'));")).toHaveLength(1);
    expect(findBannedTestRunnerImports("await import((('bun:test')));")).toHaveLength(1);
  });

  it("catches TypeScript's import-type expression", () => {
    const found = findBannedTestRunnerImports("type T = import('bun:test').Mock;");
    expect(found).toHaveLength(1);
    expect(found[0]?.form).toBe('static');
  });

  it('does not treat new.target.require as a loader', () => {
    // `ts.isMetaProperty` is true for `new.target` as well as `import.meta`,
    // so the receiver check has to name the keyword, not just the node kind.
    expect(findBannedTestRunnerImports("new.target.require('bun:test');")).toEqual([]);
  });

  it('reports each occurrence in line order', () => {
    const contents = [
      "import { test } from 'bun:test';",
      "const later = await import('bun:test');",
    ].join('\n');
    const found = findBannedTestRunnerImports(contents);
    expect(found.map((entry) => entry.line)).toEqual([1, 2]);
    expect(found.map((entry) => entry.form)).toEqual(['static', 'dynamic']);
  });

  it('reports the correct line for an import below the first line', () => {
    const contents = ["'use strict';", '', "import { test } from 'bun:test';"].join('\n');
    expect(findBannedTestRunnerImports(contents)[0]?.line).toBe(3);
  });

  it('is stable across repeated scans', () => {
    const contents = "import { test } from 'bun:test';";
    expect(findBannedTestRunnerImports(contents)).toEqual(findBannedTestRunnerImports(contents));
  });

  /**
   * The behaviour change the parser rewrite introduced, asserted rather than
   * left implicit. The regex version reported import syntax inside a comment,
   * arguing a false positive beats a false negative. A parser can tell code
   * from commentary, so that trade no longer exists — and this is also what
   * removes the need for the allowlist the old check carried, since the
   * fixtures in this very file are string literals rather than imports.
   */
  it('does not report import syntax that is only commentary or data', () => {
    expect(findBannedTestRunnerImports("// never import from 'bun:test' here")).toEqual([]);
    expect(findBannedTestRunnerImports("/* import { test } from 'bun:test'; */")).toEqual([]);
    expect(
      findBannedTestRunnerImports('const sample = "import { test } from \'bun:test\';";'),
    ).toEqual([]);
    expect(findBannedTestRunnerImports("{ name: 'bun:test', message: 'Use vitest.' }")).toEqual([]);
  });

  it('does not report a specifier that is not a compile-time constant', () => {
    // Its value is not knowable here, and guessing produces findings nobody
    // can act on.
    expect(findBannedTestRunnerImports('const t = await import(runnerName);')).toEqual([]);
    expect(findBannedTestRunnerImports('const t = await import(`bun:${kind}`);')).toEqual([]);
  });

  it('does not report other specifiers', () => {
    expect(findBannedTestRunnerImports("import { describe } from 'vitest';")).toEqual([]);
    expect(findBannedTestRunnerImports("import { file } from 'bun:jsc';")).toEqual([]);
    // Deliberate, and kept when `module.require` was added: an arbitrary
    // object with a `require` method is not a module system, so only the
    // `module.require` form is treated as a loader.
    expect(findBannedTestRunnerImports("options.require('bun:test')")).toEqual([]);
    expect(findBannedTestRunnerImports("config.require('bun:test')")).toEqual([]);
  });

  it('returns an empty array for empty input rather than throwing', () => {
    expect(findBannedTestRunnerImports('')).toEqual([]);
  });

  it('does not throw on syntactically broken input', () => {
    expect(() => findBannedTestRunnerImports('function ( { unclosed')).not.toThrow();
  });

  it('shifts reported lines by the given offset', () => {
    expect(findBannedTestRunnerImports("import 'bun:test';", 10)[0]?.line).toBe(11);
  });
});

describe('findBannedImportsInSvelte', () => {
  it('finds an import inside a script block and reports its line in the whole file', () => {
    const contents = [
      '<h1>Title</h1>',
      '<script lang="ts">',
      "  import 'bun:test';",
      '</script>',
    ].join('\n');
    const found = findBannedImportsInSvelte(contents);
    expect(found).toHaveLength(1);
    expect(found[0]?.line).toBe(3);
  });

  it('scans every script block, including module context', () => {
    const contents = [
      '<script context="module">',
      "  import 'bun:test';",
      '</script>',
      '<script>',
      "  import { test } from 'bun:test';",
      '</script>',
    ].join('\n');
    expect(findBannedImportsInSvelte(contents)).toHaveLength(2);
  });

  it('ignores markup that merely mentions the specifier', () => {
    expect(findBannedImportsInSvelte("<p>never import from 'bun:test'</p>")).toEqual([]);
  });

  /**
   * Svelte ignores markup comments entirely, so a commented-out script block
   * is not active code and rejecting a commit over it would be a false
   * positive on disabled markup.
   */
  it('ignores a script block inside a markup comment', () => {
    expect(findBannedImportsInSvelte("<!-- <script>import 'bun:test';</script> -->")).toEqual([]);
  });

  /**
   * Regression for a false negative the previous fix introduced. Blanking
   * every `<!-- ... -->` span before parsing looks right until a script holds
   * those delimiters as ordinary string data, at which point the blanking
   * swallows the live import between them. A comment is markup, so `<!--`
   * inside a script opens nothing.
   */
  it('treats comment delimiters inside a Svelte expression as markup, not a comment', () => {
    // `{'<!--'}` is an expression rendering a string, not a comment opener.
    // The hand-rolled scan read it as one and skipped past the real script.
    const contents = [
      "<p>{'<!--'}</p>",
      '<script>',
      "  import 'bun:test';",
      '</script>',
      "<p>{'-->'}</p>",
    ].join('\n');
    const found = findBannedImportsInSvelte(contents);
    expect(found).toHaveLength(1);
    expect(found[0]?.line).toBe(3);
  });

  /**
   * A component the parser rejects must never be reported as clean. The
   * earlier version returned an empty result on the reasoning that such a file
   * fails Svelte's own build — which is wrong, because `vitePreprocess()`
   * means a component can legitimately need preprocessing before Svelte's
   * parser accepts it while building fine.
   */
  it('falls back to textual script extraction when the parser rejects a component', () => {
    // `<div <<<>` is verified to make Svelte 5.56.4's parser throw ("`<div>`
    // was left open"), so this exercises the fallback rather than the parser
    // path — the two are otherwise indistinguishable here, and a fixture the
    // parser accepts would let this test pass with the fallback deleted.
    const contents = ['<div <<<>', '<script>', "  import 'bun:test';", '</script>'].join('\n');
    const found = findBannedImportsInSvelte(contents);
    expect(found).toHaveLength(1);
    expect(found[0]?.line).toBe(3);
  });

  it('orders fallback findings across multiple script blocks', () => {
    // Two findings, so the ordering actually runs: with one, `Array.sort`
    // never invokes its comparator and the ordering would be untested — which
    // is exactly how it slipped past the 100% function-coverage gate.
    const contents = [
      '<div <<<>',
      '<script context="module">',
      "  import 'bun:test';",
      '</script>',
      '<script>',
      "  const later = require('bun:test');",
      '</script>',
    ].join('\n');
    const found = findBannedImportsInSvelte(contents);
    expect(found.map((entry) => entry.line)).toEqual([3, 6]);
    expect(found.map((entry) => entry.form)).toEqual(['static', 'require']);
  });

  it('treats comment delimiters inside a script as data, not as a comment', () => {
    const contents = [
      '<script>',
      '  const opening = "<!--";',
      "  import 'bun:test';",
      '  const closing = "-->";',
      '  void opening; void closing;',
      '</script>',
    ].join('\n');
    const found = findBannedImportsInSvelte(contents);
    expect(found).toHaveLength(1);
    expect(found[0]?.line).toBe(3);
  });

  it('keeps line numbers correct for a real block after a commented one', () => {
    const contents = [
      "<!-- <script>import 'bun:test';</script> -->",
      '<script>',
      "  import 'bun:test';",
      '</script>',
    ].join('\n');
    const found = findBannedImportsInSvelte(contents);
    expect(found).toHaveLength(1);
    expect(found[0]?.line).toBe(3);
  });
});

describe('findBannedImportsForPath', () => {
  it('uses the Svelte reader only for .svelte files', () => {
    const svelte = ['<script>', "  import 'bun:test';", '</script>'].join('\n');
    expect(findBannedImportsForPath('component.svelte', svelte)).toHaveLength(1);
    expect(findBannedImportsForPath('module.ts', "import 'bun:test';")).toHaveLength(1);
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
    // `README` was in this list when the filter was an allowlist of source
    // extensions. It is not any more, and deliberately: extensionless files
    // are scanned because `bun bin/run-tests` is a real entrypoint shape, and
    // excluding prose by name would need exactly the name allowlist that
    // approach exists to avoid. Parsing a README yields no imports, so the
    // cost is nothing and the guarantee is stronger.
    for (const name of ['a.json', 'a.md', 'a.sql', 'a.svg']) {
      expect(isScannableFile(name), name).toBe(false);
    }
    expect(isScannableFile('README')).toBe(true);
  });

  it('accepts a nested path, since git reports paths rather than basenames', () => {
    expect(isScannableFile('runner/run-agent.test.mjs')).toBe(true);
    expect(isScannableFile('.github/scripts/audit-workflows.ts')).toBe(true);
  });
});

describe('extensionless entrypoints', () => {
  it('recognises a path with no extension', () => {
    expect(isExtensionlessPath('bin/run-tests')).toBe(true);
    expect(isExtensionlessPath('scripts/verify')).toBe(true);
    expect(isExtensionlessPath('module.ts')).toBe(false);
    expect(isExtensionlessPath('a/b.c/module.ts')).toBe(false);
  });

  it('scans an unrecognised or uppercase extension rather than skipping it', () => {
    // The filter lists what is *not* source. An allowlist cannot predict every
    // spelling a runnable file might use — `bun bin/run-tests.task` executes
    // JavaScript, and a case-sensitive list misses `.TS` besides.
    expect(isScannableFile('bin/run-tests.task')).toBe(true);
    expect(isScannableFile('bin/.run-tests')).toBe(true);
    expect(isScannableFile('module.TS')).toBe(true);
    expect(isScannableFile('script.sh')).toBe(true);
  });

  it('skips files that are definitely not source', () => {
    for (const name of ['a.json', 'a.md', 'a.sql', 'a.svg', 'a.woff2', 'a.MD']) {
      expect(isScannableFile(name), name).toBe(false);
    }
  });

  it('skips only binary content, not prose', () => {
    // A shebang requirement was the previous filter and excluded
    // `bun bin/run-tests`, which needs none. Prose is cheap to parse and
    // yields no imports, so only binary is worth skipping.
    expect(looksBinary('MIT License\n\nPermission is hereby granted')).toBe(false);
    expect(looksBinary('#!/usr/bin/env bun\nimport x from "y";')).toBe(false);
    expect(looksBinary('\u0000\u0001binary')).toBe(true);
  });
});
