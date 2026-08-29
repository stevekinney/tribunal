import { describe, expect, it } from 'vitest';

import {
  findBannedImportsForPath,
  findBannedImportsInSvelte,
  findBannedTestRunnerImports,
  hasForeignShebang,
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

    it('a var in a nested block no longer shadows, because its assignment cannot be proven to run', () => {
      // This asserted the opposite, on the grounds that `var` hoists. The
      // binding does hoist, and that part was right. What it missed is that
      // hoisting moves the binding and not the value: the assignment happens
      // where it is written, so the question is whether it has executed, not
      // whether the name exists.
      //
      // For a bare block like this one it has — a block with no condition
      // always runs — so this specific shape loses a correct suppression, and
      // that is a real cost rather than a technicality. But nothing
      // distinguishes it lexically from `if (false) { var require = custom; }`,
      // which never runs and was suppressing a genuine loader call. Telling
      // them apart needs control-flow analysis.
      //
      // So suppression now requires the declaration to be a direct statement of
      // a scope enclosing the call, where the two share one statement list and
      // run in order. Everything nested reports, which is the safe direction
      // for a ban.
      expect(
        findBannedTestRunnerImports("{ var require = custom; }\nrequire('bun:test');"),
      ).toHaveLength(1);
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

describe('binding positions the ancestor walk does not reach through statements', () => {
  it('an aliased import shadows, so calling it is not a loader call', () => {
    expect(
      findBannedTestRunnerImports(
        "import { load as require } from './loader';\nrequire('bun:test');\n",
      ),
    ).toHaveLength(0);
  });

  it('a default import shadows', () => {
    expect(
      findBannedTestRunnerImports("import require from './loader';\nrequire('bun:test');\n"),
    ).toHaveLength(0);
  });

  it('a namespace import shadows', () => {
    expect(
      findBannedTestRunnerImports("import * as require from './loader';\nrequire('bun:test');\n"),
    ).toHaveLength(0);
  });

  it('a type-only import clause does NOT shadow, because it is erased', () => {
    // The dangerous direction: treating an erased binding as a shadow hides a
    // real loader call.
    expect(
      findBannedTestRunnerImports(
        "import type { load as require } from './loader';\nrequire('bun:test');\n",
      ),
    ).toHaveLength(1);
  });

  it('an inline type-only specifier does NOT shadow either', () => {
    expect(
      findBannedTestRunnerImports(
        "import { type load as require } from './loader';\nrequire('bun:test');\n",
      ),
    ).toHaveLength(1);
  });

  it('an `import x = require(...)` alias shadows', () => {
    expect(
      findBannedTestRunnerImports("import require = require('./loader');\nrequire('bun:test');\n"),
    ).toHaveLength(0);
  });

  it('a type-only `import type x = require(...)` does NOT shadow, because it is erased', () => {
    expect(
      findBannedTestRunnerImports(
        "import type require = require('./types');\nrequire('bun:test');\n",
      ),
    ).toHaveLength(1);
  });

  it('a side-effect import binds nothing, so it does not shadow', () => {
    // `import './setup';` has no import clause at all. Returning early on that
    // is what keeps a genuine loader call after it reportable.
    expect(findBannedTestRunnerImports("import './setup';\nrequire('bun:test');\n")).toHaveLength(
      1,
    );
  });

  it('a catch parameter shadows within the catch block', () => {
    expect(
      findBannedTestRunnerImports("try { go(); } catch (require) { require('bun:test'); }\n"),
    ).toHaveLength(0);
  });

  it('a destructured catch parameter shadows too', () => {
    expect(
      findBannedTestRunnerImports("try { go(); } catch ({ require }) { require('bun:test'); }\n"),
    ).toHaveLength(0);
  });

  it('a for-of header binding shadows within the loop body', () => {
    expect(
      findBannedTestRunnerImports("for (const require of loaders) { require('bun:test'); }\n"),
    ).toHaveLength(0);
  });

  it('a for-in header binding shadows within the loop body', () => {
    expect(
      findBannedTestRunnerImports("for (const require in loaders) { require('bun:test'); }\n"),
    ).toHaveLength(0);
  });

  it('a classic for header binding shadows within the loop body', () => {
    expect(
      findBannedTestRunnerImports("for (let require = f; ; ) { require('bun:test'); }\n"),
    ).toHaveLength(0);
  });

  it('a named function expression binds its own name inside itself', () => {
    expect(
      findBannedTestRunnerImports("const f = function require() { require('bun:test'); };\n"),
    ).toHaveLength(0);
  });

  it('a named class expression binds its own name inside its methods', () => {
    expect(
      findBannedTestRunnerImports("const C = class require { run() { require('bun:test'); } };\n"),
    ).toHaveLength(0);
  });
});

describe('an uninitialized var redeclares rather than replaces', () => {
  it('a bare `var require;` does NOT shadow, because the CommonJS binding survives', () => {
    // Verified under Node: in a .cjs file `var require;` leaves
    // `typeof require === 'function'` and the call still loads the runner.
    // Treating it as a shadow suppressed a genuine finding.
    expect(findBannedTestRunnerImports("var require;\nrequire('bun:test');\n")).toHaveLength(1);
  });

  it('a bare `var require;` in a nested block does not shadow either', () => {
    expect(
      findBannedTestRunnerImports("function f() { { var require; } require('bun:test'); }\n"),
    ).toHaveLength(1);
  });

  it('a call BEFORE an initialized `var` still reaches the real loader', () => {
    // `var` hoists the binding but assigns its value where it is written, so
    // until that line runs the CommonJS wrapper's `require` is what a call
    // reaches. Verified under Node.
    expect(
      findBannedTestRunnerImports("require('bun:test');\nvar require = custom;\n"),
    ).toHaveLength(1);
  });

  it('a self-referential initializer evaluates its right-hand side with the real loader', () => {
    expect(findBannedTestRunnerImports("var require = require('bun:test');\n")).toHaveLength(1);
  });

  it('a call BEFORE a `var` for-of header still reaches the real loader', () => {
    // A `var` loop header assigns on entry, not at hoist time.
    expect(
      findBannedTestRunnerImports("require('bun:test');\nfor (var require of loaders) {}\n"),
    ).toHaveLength(1);
  });

  it('a call BEFORE a `var` for-in header still reaches the real loader', () => {
    expect(
      findBannedTestRunnerImports("require('bun:test');\nfor (var require in obj) {}\n"),
    ).toHaveLength(1);
  });

  it('a call inside a `var` for-of body is shadowed', () => {
    expect(
      findBannedTestRunnerImports("for (var require of loaders) { require('bun:test'); }\n"),
    ).toHaveLength(0);
  });

  it('a call inside a `var` for-in body is shadowed', () => {
    expect(
      findBannedTestRunnerImports("for (var require in obj) { require('bun:test'); }\n"),
    ).toHaveLength(0);
  });

  it('an initialized `var require = ...` does shadow', () => {
    expect(findBannedTestRunnerImports("var require = load;\nrequire('bun:test');\n")).toHaveLength(
      0,
    );
  });

  it('an uninitialized `let require;` does shadow, because let always rebinds', () => {
    expect(findBannedTestRunnerImports("let require;\nrequire('bun:test');\n")).toHaveLength(0);
  });
});

describe('lexical order is not control flow', () => {
  it('a var initializer in a dead branch does not suppress, because it never runs', () => {
    // The initializer precedes the call in source order but never executes, so
    // the CommonJS wrapper's loader is still what the call reaches. Position
    // was standing in for control-flow dominance and is not a substitute.
    expect(
      findBannedTestRunnerImports("if (false) { var require = custom; }\nrequire('bun:test');\n"),
    ).toHaveLength(1);
  });

  it('a var initializer inside any conditional does not suppress', () => {
    expect(
      findBannedTestRunnerImports(
        "function f() { if (x) { var require = custom; } require('bun:test'); }\n",
      ),
    ).toHaveLength(1);
  });

  it('a straight-line var in the same statement list does suppress', () => {
    // Statements in one list run in order, which is the strongest form of
    // dominance available for free.
    expect(
      findBannedTestRunnerImports("var require = custom;\nrequire('bun:test');\n"),
    ).toHaveLength(0);
  });
});

describe('switch clauses share one block scope', () => {
  it('an unbraced case binding shadows', () => {
    expect(
      findBannedTestRunnerImports(
        "switch (kind) { case 'x': const require = loader; require('bun:test'); }\n",
      ),
    ).toHaveLength(0);
  });

  it('a binding in one clause shadows a later clause, since the scope is the whole block', () => {
    expect(
      findBannedTestRunnerImports(
        "switch (kind) { case 'a': const require = loader; break; case 'b': require('bun:test'); }\n",
      ),
    ).toHaveLength(0);
  });

  it('a braced case block still shadows', () => {
    expect(
      findBannedTestRunnerImports(
        "switch (kind) { case 'x': { const require = loader; require('bun:test'); } }\n",
      ),
    ).toHaveLength(0);
  });
});

describe('loaders invoked through call and apply', () => {
  it('catches require.call, where the specifier is the second argument', () => {
    expect(findBannedTestRunnerImports("require.call(undefined, 'bun:test');\n")).toHaveLength(1);
  });

  it('catches module.require.call', () => {
    expect(findBannedTestRunnerImports("module.require.call(module, 'bun:test');\n")).toHaveLength(
      1,
    );
  });

  it('catches require.apply, reading the literal argument array', () => {
    expect(findBannedTestRunnerImports("require.apply(undefined, ['bun:test']);\n")).toHaveLength(
      1,
    );
  });

  it('does not report call on something that is not a loader', () => {
    expect(findBannedTestRunnerImports("options.require.call(o, 'bun:test');\n")).toHaveLength(0);
  });

  it('does not guess at a non-literal apply argument array', () => {
    // A variable holding the arguments is not statically knowable, and
    // guessing would report calls that load something else entirely.
    expect(findBannedTestRunnerImports('require.apply(undefined, args);\n')).toHaveLength(0);
  });
});

describe('a var loop header assigns on entry, not before the iterable', () => {
  it('a call in the iterable expression still reaches the real loader', () => {
    // The iterable is evaluated before the loop assigns, so comparing against
    // the declaration rather than the body suppressed a genuine load.
    expect(
      findBannedTestRunnerImports("for (var require of require('bun:test')) {}\n"),
    ).toHaveLength(1);
  });

  it('a call in the loop body is shadowed', () => {
    expect(
      findBannedTestRunnerImports("for (var require of loaders) { require('bun:test'); }\n"),
    ).toHaveLength(0);
  });
});

describe('switch clauses share a scope but not control flow', () => {
  it('a var initializer in another clause does not suppress', () => {
    // Control flow enters at one clause, so `case 0`'s initializer need never
    // have run when `case 1` executes. Flattening every clause into one list
    // made it look dominant.
    expect(
      findBannedTestRunnerImports(
        "switch (x) { case 0: var require = custom; break; case 1: require('bun:test'); }\n",
      ),
    ).toHaveLength(1);
  });

  it('a var initializer in the SAME clause does suppress', () => {
    // There is no goto in JavaScript and fall-through enters a clause at its
    // top, so statements within one clause do run in order.
    expect(
      findBannedTestRunnerImports(
        "switch (x) { case 0: var require = custom; require('bun:test'); }\n",
      ),
    ).toHaveLength(0);
  });

  it('a const in another clause still suppresses, because the scope is shared', () => {
    expect(
      findBannedTestRunnerImports(
        "switch (x) { case 0: const require = custom; break; case 1: require('bun:test'); }\n",
      ),
    ).toHaveLength(0);
  });
});

describe('immutable aliases of a loader', () => {
  it('follows `const load = require`', () => {
    expect(findBannedTestRunnerImports("const load = require;\nload('bun:test');\n")).toHaveLength(
      1,
    );
  });

  it('follows a chain of const aliases', () => {
    expect(
      findBannedTestRunnerImports(
        "const load = require;\nconst other = load;\nother('bun:test');\n",
      ),
    ).toHaveLength(1);
  });

  it('resolves the INNERMOST binding, so an inner shadow wins', () => {
    // Taking any enclosing alias would report valid code here.
    expect(
      findBannedTestRunnerImports(
        "const load = require;\n{ const load = other; load('bun:test'); }\n",
      ),
    ).toHaveLength(0);
  });

  it('does not follow an alias of a parameter named require', () => {
    expect(
      findBannedTestRunnerImports(
        "function f(require) { const load = require; load('bun:test'); }\n",
      ),
    ).toHaveLength(0);
  });

  it('a parameter of the same name shadows an outer alias', () => {
    // Without checking parameters the walk would reach the outer
    // `const load = require` and report a call to the parameter.
    expect(
      findBannedTestRunnerImports(
        "const load = require;\nfunction f(load) { load('bun:test'); }\n",
      ),
    ).toHaveLength(0);
  });

  it('an inner function declaration of the same name shadows an outer alias', () => {
    expect(
      findBannedTestRunnerImports(
        "const load = require;\nfunction g() { function load(n) { return n; } load('bun:test'); }\n",
      ),
    ).toHaveLength(0);
  });

  it('follows an alias declared in a switch clause', () => {
    expect(
      findBannedTestRunnerImports(
        "switch (x) { case 0: const load = require; load('bun:test'); }\n",
      ),
    ).toHaveLength(1);
  });

  it('does not follow a `let` alias, which is not immutable', () => {
    // Out of scope deliberately, and it fails toward not reporting. This is a
    // lint against accidents, not a boundary against deliberate evasion.
    expect(findBannedTestRunnerImports("let load = require;\nload('bun:test');\n")).toHaveLength(0);
  });
});

describe('erased declarations are not runtime bindings', () => {
  it('a bodyless overload signature does not shadow', () => {
    // It emits nothing even without a `declare` modifier; only the
    // implementation binds.
    expect(
      findBannedTestRunnerImports(
        "function require(name: string): unknown;\nrequire('bun:test');\n",
      ),
    ).toHaveLength(1);
  });

  it('a function with a body does shadow', () => {
    expect(
      findBannedTestRunnerImports("function require(n) { return n; }\nrequire('bun:test');\n"),
    ).toHaveLength(0);
  });
});

describe("Node's createRequire returns a real loader", () => {
  it('catches a call on the loader it returns', () => {
    expect(
      findBannedTestRunnerImports(
        "import { createRequire } from 'node:module';\ncreateRequire(import.meta.url)('bun:test');\n",
      ),
    ).toHaveLength(1);
  });

  it('catches the conventional `const require = createRequire(...)` spelling', () => {
    // This is how `packages/test/src/database.ts` reaches CommonJS from ESM, so
    // it is the ordinary spelling rather than an evasive one. The name is bound
    // by that `const`, so the plain shadow check says "not the CommonJS
    // wrapper" and the alias resolution has to carry it from there.
    expect(
      findBannedTestRunnerImports(
        "import { createRequire } from 'node:module';\nconst require = createRequire(import.meta.url);\nrequire('bun:test');\n",
      ),
    ).toHaveLength(1);
  });

  it('catches it through a namespace import', () => {
    expect(
      findBannedTestRunnerImports(
        "import * as m from 'node:module';\nm.createRequire(import.meta.url)('bun:test');\n",
      ),
    ).toHaveLength(1);
  });

  it('does not treat an unrelated createRequire from another module as a loader', () => {
    // The binding is inspected rather than counted: a plain shadow check gets
    // this backwards, because the name is always bound — it has to be imported
    // to be used, and that import is what identifies it.
    expect(
      findBannedTestRunnerImports(
        "import { createRequire } from './mine';\ncreateRequire(import.meta.url)('bun:test');\n",
      ),
    ).toHaveLength(0);
  });
});

describe('alias resolution stops at every nearer binding', () => {
  it('a loop header binding shadows an outer alias', () => {
    expect(
      findBannedTestRunnerImports(
        "const load = require;\nfor (const load of loaders) { load('bun:test'); }\n",
      ),
    ).toHaveLength(0);
  });

  it('a hoisted local var shadows an outer alias even before its assignment', () => {
    // This is the case that distinguishes naming from replacement. `var load`
    // is hoisted through the whole function, so inside `f` the name refers to
    // the local no matter where the call sits — verified under Node, where the
    // call throws TypeError rather than loading anything:
    //
    //     throws: TypeError
    //
    // Shadow resolution asks whether the assignment has run, and would answer
    // "not yet" and reach past to the outer alias. Alias resolution asks only
    // whether the binding exists, which is why it passes `ignoreOrder`.
    expect(
      findBannedTestRunnerImports(
        "const load = require;\nfunction f() { load('bun:test'); var load = other; }\n",
      ),
    ).toHaveLength(0);
  });

  it('a catch parameter shadows an outer alias', () => {
    // These two were reachable because the alias resolver had its own partial
    // copy of binding resolution. There is one resolver now.
    expect(
      findBannedTestRunnerImports(
        "const load = require;\ntry { go(); } catch (load) { load('bun:test'); }\n",
      ),
    ).toHaveLength(0);
  });
});

describe('createRequire is decided by provenance, not by spelling', () => {
  it('follows an aliased named import', () => {
    expect(
      findBannedTestRunnerImports(
        "import { createRequire as makeRequire } from 'node:module';\nmakeRequire(import.meta.url)('bun:test');\n",
      ),
    ).toHaveLength(1);
  });

  it('does not accept a same-named export from an unrelated module', () => {
    expect(
      findBannedTestRunnerImports(
        "import { createRequire } from './helpers';\ncreateRequire(url)('bun:test');\n",
      ),
    ).toHaveLength(0);
  });

  it('does not accept a member call on an unrelated namespace', () => {
    // The first version checked provenance for the named import and took the
    // member form on the property name alone, which reported valid code.
    expect(
      findBannedTestRunnerImports(
        "import * as helpers from './helpers';\nhelpers.createRequire(url)('bun:test');\n",
      ),
    ).toHaveLength(0);
  });

  it('accepts a member call on the node:module namespace', () => {
    expect(
      findBannedTestRunnerImports(
        "import * as m from 'node:module';\nm.createRequire(url)('bun:test');\n",
      ),
    ).toHaveLength(1);
  });
});

describe('module format decides whether a hoisted var leaves a loader behind', () => {
  it('reports in CommonJS, where the wrapper parameter survives the redeclaration', () => {
    expect(
      findBannedTestRunnerImports(
        "try { require('bun:test'); } catch {}\nvar require = custom;\n",
        0,
        'probe.cjs',
      ),
    ).toHaveLength(1);
  });

  it('does not report in an ES module, where the hoisted var is undefined', () => {
    // No wrapper parameter exists to survive, so the call throws instead of
    // loading. Confirmed by running the same source as `.cjs` and `.mjs`.
    expect(
      findBannedTestRunnerImports(
        "try { require('bun:test'); } catch {}\nvar require = custom;\n",
        0,
        'probe.mjs',
      ),
    ).toHaveLength(0);
  });

  it('keeps the CommonJS reading for ambiguous extensions', () => {
    // `.ts` and `.js` depend on the nearest package.json `type`, which this
    // validator does not read, so they keep the reading that reports.
    expect(
      findBannedTestRunnerImports(
        "try { require('bun:test'); } catch {}\nvar require = custom;\n",
        0,
        'probe.ts',
      ),
    ).toHaveLength(1);
  });
});

describe('a namespace body is a scope', () => {
  it('a local binding inside a TypeScript namespace shadows', () => {
    expect(
      findBannedTestRunnerImports("namespace N { const require = load; require('bun:test'); }\n"),
    ).toHaveLength(0);
  });
});

describe('a shebang decides the language only when nothing else does', () => {
  it('still scans a known JavaScript extension that begins with a foreign hashbang', () => {
    // A hashbang is a valid JavaScript comment, so this is still JavaScript —
    // Bun runs it and a `*.test.mjs` vitest project collects it.
    expect(
      findBannedImportsForPath('runner/probe.test.mjs', "#!/bin/sh\nimport 'bun:test';\n"),
    ).toHaveLength(1);
  });

  it('still skips an extensionless file whose shebang names another interpreter', () => {
    expect(findBannedImportsForPath('bin/tool', "#!/bin/sh\n# import 'bun:test'\n")).toHaveLength(
      0,
    );
  });
});

describe('hasForeignShebang', () => {
  it('rejects a python shebang', () => {
    expect(hasForeignShebang("#!/usr/bin/env python3\n# import 'bun:test'\n")).toBe(true);
  });

  it('rejects a shell shebang', () => {
    expect(hasForeignShebang('#!/bin/sh\necho hi\n')).toBe(true);
  });

  it('accepts a bun shebang', () => {
    expect(hasForeignShebang('#!/usr/bin/env bun\n')).toBe(false);
  });

  it('accepts a node shebang', () => {
    expect(hasForeignShebang('#!/usr/bin/env node\n')).toBe(false);
  });

  it('admits a file with no shebang, preserving the entrypoint that rule excluded', () => {
    // `bun bin/run-tests` executes a file with no shebang at all. A missing
    // shebang must never exclude, or that real entrypoint stops being scanned.
    expect(hasForeignShebang("import 'bun:test';\n")).toBe(false);
  });

  it('handles a single-line file with no trailing newline', () => {
    expect(hasForeignShebang('#!/bin/bash')).toBe(true);
  });
});

describe('sources that are not JavaScript are never handed to the TypeScript parser', () => {
  it("does not report a python comment, which TypeScript's recovery turns into an import", () => {
    expect(
      findBannedImportsForPath('scripts/tool.py', "#!/usr/bin/env python3\n# import 'bun:test'\n"),
    ).toHaveLength(0);
  });

  it('does not report a shell comment', () => {
    expect(findBannedImportsForPath('bin/go.sh', "#!/bin/sh\n# import 'bun:test'\n")).toHaveLength(
      0,
    );
  });

  it('rejects a Dockerfile by basename, since it has neither extension nor shebang', () => {
    expect(isScannableFile('Dockerfile')).toBe(false);
    expect(isScannableFile('applications/web/Dockerfile.production')).toBe(false);
  });

  it('rejects configuration dotfiles, including suffixed variants', () => {
    expect(isScannableFile('.env')).toBe(false);
    expect(isScannableFile('.env.example')).toBe(false);
    expect(isScannableFile('.gitignore')).toBe(false);
  });

  it('still admits an extensionless JavaScript entrypoint', () => {
    expect(isScannableFile('bin/run-tests')).toBe(true);
    expect(findBannedImportsForPath('bin/run-tests', "import 'bun:test';\n")).toHaveLength(1);
  });

  it('still admits a dotfile that really is JavaScript', () => {
    expect(isScannableFile('.eslintrc.js')).toBe(true);
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

describe('the unparseable-Svelte fallback ignores commented-out markup', () => {
  it('reports a commented-out script too, deliberately, because the fallback fails closed', () => {
    // This previously asserted the opposite — that a commented-out script is
    // not reported — and the masking that made it pass has been removed.
    //
    // What it asserted was that the fallback should distinguish comments from
    // code. It cannot, without Svelte's grammar. The comment above
    // `parseSvelte` had already named the spelling that breaks a regex attempt
    // at it, `{'<!--'}` in an expression, and it did: delimiters written
    // either side of a real script blanked the script, so a genuine banned
    // import went unreported. The test below pins that.
    //
    // The new behaviour is correct because this fallback runs only for a
    // component Svelte's own parser rejected. Reporting a commented-out script
    // there costs a clear failure on an already-broken file; missing a real
    // import costs the ban.
    const component =
      '<script lang="ts">\n  const x = 1;\n</script>\n\n' +
      "<!-- <script>import 'bun:test'</script> -->\n{#if x}\n<p>unclosed\n";
    expect(findBannedImportsForPath('src/Broken.svelte', component)).toHaveLength(1);
  });

  it('reports an active script bracketed by expressions that look like comment delimiters', () => {
    // `{'<!--'}` and `{'-->'}` are Svelte expressions rendering literal text,
    // not markup comments. Blanking between them hid the real script.
    const component =
      "<p>{'<!--'}</p>\n<script lang=\"ts\">\n  import 'bun:test';\n</script>\n" +
      "<p>{'-->'}</p>\n{#if x}\n<p>unclosed\n";
    expect(findBannedImportsForPath('src/Bracketed.svelte', component)).toHaveLength(1);
  });

  it('still reports an active script in a component the parser rejects', () => {
    const component =
      '<script lang="ts">\n  import \'bun:test\';\n</script>\n{#if x}\n<p>unclosed\n';
    expect(findBannedImportsForPath('src/Broken.svelte', component)).toHaveLength(1);
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

  it('skips an unrecognised extension, and still scans uppercase and extensionless', () => {
    // This asserted that `bin/run-tests.task` is scanned, on the grounds that
    // an allowlist cannot predict every spelling a runnable file might use.
    // That reasoning was sound and its premise was not: it assumed parsing a
    // non-module is harmless, and TypeScript's parser recovers instead of
    // failing, so `# import 'bun:test'` in any hash-commented language becomes
    // a reported import and blocks every commit.
    //
    // Three rounds added the languages observed so far. The tail does not end
    // — Lua's `require('bun:test')` is valid Lua that parses as a JavaScript
    // call — while this repository tracks no exotic-but-JavaScript extension at
    // all. And the false-negative cost is capped by the rule's purpose: it bans
    // a runner whose suites silently do not run under vitest, and a file no
    // runner collects cannot be a silently-skipped suite.
    expect(isScannableFile('bin/run-tests.task')).toBe(false);

    // The two cases that still hold, and the reason the check is not a plain
    // extension equality test: case-insensitivity, and extensionless
    // entrypoints, which the shebang decides on once the contents are read.
    expect(isScannableFile('module.TS')).toBe(true);
    expect(isScannableFile('bin/.run-tests')).toBe(true);
    expect(isScannableFile('bin/run-tests')).toBe(true);
  });

  it('skips shell, which this test previously asserted was scanned', () => {
    // `script.sh` was an assertion of the case above: `.sh` was not listed, so
    // it was scanned, and that was cited as the inverted filter working. The
    // principle is unchanged and the three cases above still prove it — an
    // unrecognised spelling is still scanned. What changed is that `.sh` is no
    // longer unrecognised.
    //
    // It is listed now because parsing shell as TypeScript is not harmless.
    // The parser recovers rather than failing: `# import 'bun:test'` becomes a
    // real ImportDeclaration, so an ordinary comment in any of the fourteen
    // `#`-commented files this repository tracks made the always-on hook
    // reject every commit.
    expect(isScannableFile('script.sh')).toBe(false);
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
