import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { resolveRepositoryRoot } from './repository-root';

// A deadline without `killSignal` is not a deadline. `spawnSync`'s `timeout`
// sends its default signal and then *waits* for the child, so a process that
// traps or ignores SIGTERM runs past the budget — measured in this repository
// at 4019ms against 400ms. `.claude/rules/scripts.md` states the rule; this is
// the check that makes it hold, because the rule alone did not.
//
// Three things this check has already got wrong, kept here because each fix is
// the interesting part:
//
//  1. It named its files. A hand-maintained list is the defect this guard
//     exists to remove, and it silently omitted a spawner.
//  2. It then walked the filesystem, which the same rules file forbids: a walk
//     enters ignored directories and fails the repository over a stale copy
//     git would never commit. The enumeration is git's now.
//  3. It asserted on the file's *text*, so a file containing one compliant call
//     and one unbounded call passed — both strings were present somewhere. Each
//     call is inspected on its own now.
const here = dirname(fileURLToPath(import.meta.url));
const root =
  typeof (import.meta as { dir?: string }).dir === 'string'
    ? resolveRepositoryRoot()
    : join(here, '..', '..');

const SOURCE = /\.(ts|tsx|mts|cts|js|mjs|cjs)$/;

/** Every `spawnSync` call in a source text that sets a `timeout`. */

/**
 * A string constant, resolved through a name when it is held in one.
 *
 * `const killSignal = 'SIGKILL'; spawnSync(..., { timeout, killSignal })` is
 * compliant code, and reading only an inline literal called it unbounded — a
 * false positive in a guard, which fails the suite over correct source rather
 * than letting a bad call through.
 */
function constantString(source: ts.SourceFile, node: ts.Node | undefined): string | undefined {
  if (node === undefined) return undefined;
  if (ts.isStringLiteralLike(node)) return node.text;
  if (!ts.isIdentifier(node)) return undefined;
  let found: string | undefined;
  const visit = (candidate: ts.Node): void => {
    if (
      ts.isVariableDeclaration(candidate) &&
      ts.isIdentifier(candidate.name) &&
      candidate.name.text === node.text &&
      candidate.initializer !== undefined &&
      ts.isStringLiteralLike(candidate.initializer)
    ) {
      found = candidate.initializer.text;
    }
    ts.forEachChild(candidate, visit);
  };
  visit(source);
  return found;
}

/** The initializer a name is declared with in this file, if any. */
function declaredInitializer(source: ts.SourceFile, name: string): ts.Expression | undefined {
  let found: ts.Expression | undefined;
  const visit = (candidate: ts.Node): void => {
    if (
      ts.isVariableDeclaration(candidate) &&
      ts.isIdentifier(candidate.name) &&
      candidate.name.text === name &&
      candidate.initializer !== undefined
    ) {
      found = candidate.initializer;
    }
    ts.forEachChild(candidate, visit);
  };
  visit(source);
  return found;
}

/**
 * The object literal an options argument names, however it was reached.
 *
 * One reader for every spelling: a literal, a name bound to one, either
 * spelling of a member read, an index into a list, and `Object.freeze` around
 * any of them. Each of those was added after the previous reader missed it,
 * which is the argument for resolving them in one place rather than at each
 * call site.
 */
function resolveOptions(
  source: ts.SourceFile,
  node: ts.Node | undefined,
  seen: ReadonlySet<ts.Node> = new Set(),
): ts.ObjectLiteralExpression | undefined {
  if (node === undefined || seen.has(node)) return undefined;
  const guarded = new Set([...seen, node]);

  if (ts.isObjectLiteralExpression(node)) return node;

  // `Object.freeze({ ... })` returns the object handed to it, and freezing a
  // shared options preset is the idiomatic way to write one.
  if (
    ts.isCallExpression(node) &&
    node.arguments.length === 1 &&
    ts.isPropertyAccessExpression(node.expression) &&
    ts.isIdentifier(node.expression.expression) &&
    node.expression.expression.text === 'Object' &&
    (node.expression.name.text === 'freeze' || node.expression.name.text === 'seal')
  ) {
    return resolveOptions(source, node.arguments[0], guarded);
  }

  if (ts.isIdentifier(node)) {
    return resolveOptions(source, declaredInitializer(source, node.text), guarded);
  }

  // `presets[0]` reads out of a list rather than off an object — the same
  // statically known read written against the other container.
  if (ts.isElementAccessExpression(node) && ts.isNumericLiteral(node.argumentExpression)) {
    const list = resolveList(source, node.expression, guarded);
    return resolveOptions(source, list?.elements[Number(node.argumentExpression.text)], guarded);
  }

  // Both spellings of a member read call the same function, so recognising
  // only the dotted one is bypassed by writing the bracketed one.
  const key = ts.isPropertyAccessExpression(node)
    ? node.name.text
    : ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)
      ? node.argumentExpression.text
      : undefined;
  if (key === undefined) return undefined;

  const receiver = resolveOptions(
    source,
    (node as ts.PropertyAccessExpression).expression,
    guarded,
  );
  const property = receiver?.properties.find(
    (candidate) =>
      candidate.name !== undefined &&
      ts.isIdentifier(candidate.name) &&
      candidate.name.text === key,
  );
  return property !== undefined && ts.isPropertyAssignment(property)
    ? resolveOptions(source, property.initializer, guarded)
    : undefined;
}

/** The array literal an expression names, resolved the same way options are. */
function resolveList(
  source: ts.SourceFile,
  node: ts.Node,
  seen: ReadonlySet<ts.Node>,
): ts.ArrayLiteralExpression | undefined {
  if (seen.has(node)) return undefined;
  if (ts.isArrayLiteralExpression(node)) return node;
  if (ts.isIdentifier(node)) {
    const initializer = declaredInitializer(source, node.text);
    return initializer === undefined
      ? undefined
      : resolveList(source, initializer, new Set([...seen, node]));
  }
  return undefined;
}

/**
 * The properties an options object actually has at run time, spreads resolved.
 *
 * `const deadline = { timeout: 10 }; spawnSync('x', [], { ...deadline })` sets
 * a deadline the previous reader could not see, because it looked only at
 * properties written in place and concluded there was none to bound. Later
 * properties win, exactly as they do at run time, so
 * `{ ...deadline, killSignal: 'SIGTERM' }` reads as SIGTERM rather than as
 * whatever the spread supplied.
 */
function flattenedProperties(
  source: ts.SourceFile,
  options: ts.ObjectLiteralExpression,
  seen: ReadonlySet<ts.Node> = new Set(),
): Map<string, ts.ObjectLiteralElementLike> {
  const properties = new Map<string, ts.ObjectLiteralElementLike>();
  if (seen.has(options)) return properties;
  const guarded = new Set([...seen, options]);
  for (const property of options.properties) {
    if (ts.isSpreadAssignment(property)) {
      // Resolved by the same reader the options argument goes through, so a
      // spread of `presets.strict` is followed exactly as passing it directly
      // is. Two readers for one question is how the gap above happened.
      const spread = resolveOptions(source, property.expression);
      if (spread === undefined) continue;
      for (const [name, value] of flattenedProperties(source, spread, guarded)) {
        properties.set(name, value);
      }
      continue;
    }
    if (property.name !== undefined && ts.isIdentifier(property.name)) {
      properties.set(property.name.text, property);
    }
  }
  return properties;
}

/** Whether a specifier names Node's spawner, or a module inside this repository. */
function spawnOrigin(specifier: ts.Expression | undefined): 'node' | 'repository' | undefined {
  if (specifier === undefined || !ts.isStringLiteralLike(specifier)) return undefined;
  if (specifier.text === 'node:child_process' || specifier.text === 'child_process') return 'node';
  return specifier.text.startsWith('.') ? 'repository' : undefined;
}

/**
 * The names in one file that refer to `spawnSync`, and the ones it re-exports.
 *
 * `known` carries the names other tracked modules already export as aliases,
 * which is what lets a caller be recognised across a module boundary:
 * `export { spawnSync as spawn } from 'node:child_process'` in one file makes
 * `import { spawn } from './spawner'` a spawner in another, though that second
 * file contains the string `spawnSync` nowhere.
 *
 * Visited twice because `export { local as name }` can be written above the
 * import that binds `local`, and one pass in source order would miss it.
 */
export function spawnAliasesIn(
  parsed: ts.SourceFile,
  known: ReadonlySet<string>,
): { local: Set<string>; exported: Set<string> } {
  const local = new Set<string>();
  const exported = new Set<string>();

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      const origin = spawnOrigin(node.moduleSpecifier);
      const named = node.importClause?.namedBindings;
      if (origin !== undefined && named !== undefined && ts.isNamedImports(named)) {
        for (const element of named.elements) {
          const imported = element.propertyName?.text ?? element.name.text;
          const refers = origin === 'node' ? imported === 'spawnSync' : known.has(imported);
          if (refers) local.add(element.name.text);
        }
      }
    }
    if (
      ts.isExportDeclaration(node) &&
      node.exportClause !== undefined &&
      ts.isNamedExports(node.exportClause)
    ) {
      const origin = spawnOrigin(node.moduleSpecifier);
      for (const element of node.exportClause.elements) {
        const from = element.propertyName?.text ?? element.name.text;
        const refers =
          origin === 'node'
            ? from === 'spawnSync'
            : origin === 'repository'
              ? known.has(from)
              : local.has(from);
        if (refers) exported.add(element.name.text);
      }
    }
    if (ts.isVariableStatement(node)) {
      const shared =
        node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) === true;
      for (const declaration of node.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) continue;
        const initializer = declaration.initializer;
        if (initializer === undefined || !ts.isIdentifier(initializer)) continue;
        if (initializer.text !== 'spawnSync' && !local.has(initializer.text)) continue;
        local.add(declaration.name.text);
        if (shared) exported.add(declaration.name.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  visit(parsed);
  return { local, exported };
}

/**
 * Every name any tracked module exports as a `spawnSync` alias.
 *
 * Selecting files by whether their text mentions `spawnSync` was itself a hole
 * in this guard: a module can re-export the spawner under another name, and
 * its caller then mentions the spawner nowhere and was excluded before any AST
 * was built. The set is grown to a fixpoint so a chain of re-exports is
 * followed rather than only the first hop; it only ever grows and is bounded
 * by the number of exported names, so it terminates.
 */
export function exportedSpawnAliases(files: ReadonlyMap<string, string>): Set<string> {
  const aliases = new Set<string>();
  const mentionsAny = (text: string): boolean =>
    text.includes('spawnSync') || [...aliases].some((name) => mentionsName(text, name));

  for (;;) {
    let grew = false;
    for (const [path, text] of files) {
      if (!mentionsAny(text)) continue;
      const parsed = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
      for (const name of spawnAliasesIn(parsed, aliases).exported) {
        if (aliases.has(name)) continue;
        aliases.add(name);
        grew = true;
      }
    }
    if (!grew) return aliases;
  }
}

/** A whole-word mention, so `spawnable` does not select a file for `spawn`. */
function mentionsName(text: string, name: string): boolean {
  return new RegExp(`\\b${name}\\b`).test(text);
}

export function unboundedSpawnCalls(
  source: string,
  fileName: string,
  known: ReadonlySet<string> = new Set(),
): number[] {
  const parsed = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const offenders: number[] = [];

  // Local names bound to the spawner, however it was spelled and wherever it
  // was imported from.
  const aliases = spawnAliasesIn(parsed, known).local;

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const name = ts.isIdentifier(callee)
        ? callee.text
        : ts.isPropertyAccessExpression(callee)
          ? callee.name.text
          : undefined;
      // The local name may be an alias: `import { spawnSync as spawn }`. The
      // file is selected because its import mentions `spawnSync`, so checking
      // only the callee's text found no calls at all and reported the file
      // clean — the guard was silent about exactly what it selected the file
      // for.
      if (name !== undefined && (name === 'spawnSync' || aliases.has(name))) {
        // The options may be held in a variable: `const options = { timeout: 10 };
        // spawnSync('x', [], options)`. Looking only for an inline literal
        // treated that call as compliant because it found nothing to inspect.
        // Node's signature is `spawnSync(command, args, options)`; Bun's is
        // `Bun.spawnSync(command, options)`. Always reading index 2 meant the
        // guard never inspected a `Bun.spawnSync` call — including the one in
        // `scripts/validate-test-runner-imports.ts`, which is the very file
        // this invariant was added to protect.
        const isBunApi =
          ts.isPropertyAccessExpression(callee) &&
          ts.isIdentifier(callee.expression) &&
          callee.expression.text === 'Bun';
        const argument = isBunApi ? node.arguments[1] : node.arguments[2];
        const options = resolveOptions(parsed, argument);
        if (options !== undefined) {
          const resolved = flattenedProperties(parsed, options);
          const deadline = resolved.get('timeout');
          const signal = resolved.get('killSignal');
          // The *value* matters, not the property. `killSignal: 'SIGTERM'` is
          // the default a child can trap, so accepting any signal accepts the
          // very thing the rule exists to prevent.
          const configured =
            signal === undefined
              ? undefined
              : ts.isPropertyAssignment(signal)
                ? constantString(parsed, signal.initializer)
                : ts.isShorthandPropertyAssignment(signal)
                  ? constantString(parsed, signal.name)
                  : undefined;
          const nonIgnorable = configured === 'SIGKILL';
          if (deadline !== undefined && !nonIgnorable) {
            offenders.push(parsed.getLineAndCharacterOfPosition(node.getStart()).line + 1);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return offenders;
}

const tracked = execFileSync('git', ['ls-files', '-z'], {
  cwd: root,
  encoding: 'utf8',
  maxBuffer: 32 * 1024 * 1024,
})
  .split('\0')
  .filter((path) => path.length > 0 && SOURCE.test(path));

const sources = new Map(tracked.map((path) => [path, readFileSync(join(root, path), 'utf8')]));
const repositoryAliases = exportedSpawnAliases(sources);

// A file is inspected when it mentions the spawner *or* any name the
// repository exports as an alias of it. The previous filter asked only the
// first question, so a caller reached through a re-export was excluded before
// its AST was ever built.
const spawners = [...sources]
  .filter(
    ([, text]) =>
      text.includes('spawnSync') ||
      [...repositoryAliases].some((name) => new RegExp(`\\b${name}\\b`).test(text)),
  )
  .map(([path]) => path)
  .sort();

describe('every subprocess deadline is enforceable', () => {
  it('enumerates the spawners rather than trusting a list', () => {
    expect(spawners.length).toBeGreaterThan(0);
  });

  it.each(spawners)('%s bounds every deadline it sets', (relativePath) => {
    const source = sources.get(relativePath) ?? '';
    expect(unboundedSpawnCalls(source, relativePath, repositoryAliases)).toEqual([]);
  });

  it('catches an unbounded call sitting beside a compliant one', () => {
    // The failure the previous, text-based version missed: both strings are
    // present in the file, so a whole-file assertion passed.
    const source = [
      "import { spawnSync } from 'node:child_process';",
      "spawnSync('a', [], { timeout: 10, killSignal: 'SIGKILL' });",
      "spawnSync('b', [], { timeout: 10 });",
    ].join('\n');
    expect(unboundedSpawnCalls(source, 'probe.ts')).toEqual([3]);
  });

  it('accepts a call that sets no deadline at all', () => {
    expect(unboundedSpawnCalls("spawnSync('a', []);\n", 'probe.ts')).toEqual([]);
  });

  it("reads Bun.spawnSync's two-argument signature", () => {
    // Node takes `(command, args, options)`; Bun takes `(command, options)`.
    // Always reading index 2 meant this guard never inspected the repository's
    // own spawner, which is a `Bun.spawnSync` call.
    expect(unboundedSpawnCalls('Bun.spawnSync(cmd, { timeout: 10 });\n', 'p.ts')).toEqual([1]);
    expect(
      unboundedSpawnCalls("Bun.spawnSync(cmd, { timeout: 10, killSignal: 'SIGKILL' });\n", 'p.ts'),
    ).toEqual([]);
  });

  it('follows an aliased spawnSync import', () => {
    const source = [
      "import { spawnSync as spawn } from 'node:child_process';",
      "spawn('x', [], { timeout: 10 });",
    ].join('\n');
    expect(unboundedSpawnCalls(source, 'p.ts')).toEqual([2]);
  });

  it('resolves options held in a variable', () => {
    // Looking only for an inline literal found nothing to inspect and called
    // the deadline compliant.
    const source = ['const options = { timeout: 10 };', "spawnSync('x', [], options);"].join('\n');
    expect(unboundedSpawnCalls(source, 'p.ts')).toEqual([2]);
  });

  it('resolves a deadline supplied through a spread', () => {
    // `propertyNamed` read only properties written in place, so a spread
    // carried the deadline past it and the call was called compliant because
    // there appeared to be nothing to bound.
    const spread = ['const deadline = { timeout: 10 };', "spawnSync('x', [], { ...deadline });"];
    expect(unboundedSpawnCalls(spread.join('\n'), 'p.ts')).toEqual([2]);

    const bounded = [
      "const deadline = { timeout: 10, killSignal: 'SIGKILL' };",
      "spawnSync('x', [], { ...deadline });",
    ];
    expect(unboundedSpawnCalls(bounded.join('\n'), 'p.ts')).toEqual([]);
  });

  it('lets a later property override what a spread supplied, as the runtime does', () => {
    const overridden = [
      "const deadline = { timeout: 10, killSignal: 'SIGKILL' };",
      "spawnSync('x', [], { ...deadline, killSignal: 'SIGTERM' });",
    ];
    expect(unboundedSpawnCalls(overridden.join('\n'), 'p.ts')).toEqual([2]);
  });

  it('recognises a spawner reached through another module', () => {
    // The caller mentions `spawnSync` nowhere, so the text filter excluded it
    // before any AST was built — an unbounded deadline behind one re-export
    // passed a guard whose whole purpose is that none can.
    const files = new Map([
      ['spawner.ts', "export { spawnSync as spawn } from 'node:child_process';"],
      ['caller.ts', "import { spawn } from './spawner';\nspawn('x', [], { timeout: 10 });"],
    ]);
    const aliases = exportedSpawnAliases(files);
    expect([...aliases]).toEqual(['spawn']);
    expect(unboundedSpawnCalls(files.get('caller.ts') ?? '', 'caller.ts', aliases)).toEqual([2]);
    // Without the index the caller is invisible, which is precisely the state
    // this guard was in.
    expect(unboundedSpawnCalls(files.get('caller.ts') ?? '', 'caller.ts')).toEqual([]);
  });

  it('follows a chain of re-exports rather than only the first hop', () => {
    const files = new Map([
      ['a.ts', "export { spawnSync as spawn } from 'node:child_process';"],
      ['b.ts', "export { spawn as launch } from './a';"],
      ['c.ts', "import { launch } from './b';\nlaunch('x', [], { timeout: 10 });"],
    ]);
    const aliases = exportedSpawnAliases(files);
    expect([...aliases].sort()).toEqual(['launch', 'spawn']);
    expect(unboundedSpawnCalls(files.get('c.ts') ?? '', 'c.ts', aliases)).toEqual([2]);
  });

  it('does not treat an unrelated import of the same name as the spawner', () => {
    // The alias index answers which *names* alias the spawner, not which
    // module a name came from. A name imported from a module that exports no
    // alias is not one.
    const files = new Map([
      ['only.ts', "import { spawn } from './pty';\nspawn('x', [], { timeout: 10 });"],
    ]);
    expect([...exportedSpawnAliases(files)]).toEqual([]);
  });

  it('reads a signal held in a name, or written in shorthand', () => {
    // Both are compliant code the previous reader called unbounded. A guard
    // that fails the suite over correct source is worse than one that misses a
    // call, because it teaches people to route around it.
    const shorthand = [
      "const killSignal = 'SIGKILL';",
      "spawnSync('x', [], { timeout: 10, killSignal });",
    ];
    expect(unboundedSpawnCalls(shorthand.join('\n'), 'p.ts')).toEqual([]);

    const named = [
      "const signal = 'SIGKILL';",
      "spawnSync('x', [], { timeout: 10, killSignal: signal });",
    ];
    expect(unboundedSpawnCalls(named.join('\n'), 'p.ts')).toEqual([]);

    const ignorable = [
      "const signal = 'SIGTERM';",
      "spawnSync('x', [], { timeout: 10, killSignal: signal });",
    ];
    expect(unboundedSpawnCalls(ignorable.join('\n'), 'p.ts')).toEqual([2]);
  });

  it('resolves options reached through a key on a declared object', () => {
    const source = [
      'const presets = { strict: { timeout: 10 } };',
      "spawnSync('x', [], presets.strict);",
    ];
    expect(unboundedSpawnCalls(source.join('\n'), 'p.ts')).toEqual([2]);
  });

  it('resolves options behind a bracketed key, and a spread of one', () => {
    // Both spellings of a member read call the same function, so recognising
    // only the dotted one is bypassed by writing the bracketed one. And a
    // spread now goes through the same reader the options argument does —
    // two readers for one question is what left the gap it closes.
    const bracketed = [
      'const presets = { strict: { timeout: 10 } };',
      "spawnSync('x', [], presets['strict']);",
    ];
    expect(unboundedSpawnCalls(bracketed.join('\n'), 'p.ts')).toEqual([2]);

    const spreadOfMember = [
      'const presets = { strict: { timeout: 10 } };',
      "spawnSync('x', [], { ...presets.strict });",
    ];
    expect(unboundedSpawnCalls(spreadOfMember.join('\n'), 'p.ts')).toEqual([2]);
  });

  it('resolves frozen options and options held in a list', () => {
    // Both readers grew one spelling at a time until they were rewritten as
    // one: a literal, a name, either member spelling, a list index, and
    // `Object.freeze` around any of them.
    const frozen = ['const o = Object.freeze({ timeout: 10 });', "spawnSync('x', [], o);"];
    expect(unboundedSpawnCalls(frozen.join('\n'), 'p.ts')).toEqual([2]);

    const listed = ['const presets = [{ timeout: 10 }];', "spawnSync('x', [], presets[0]);"];
    expect(unboundedSpawnCalls(listed.join('\n'), 'p.ts')).toEqual([2]);

    const frozenBounded = [
      "const o = Object.freeze({ timeout: 10, killSignal: 'SIGKILL' });",
      "spawnSync('x', [], o);",
    ];
    expect(unboundedSpawnCalls(frozenBounded.join('\n'), 'p.ts')).toEqual([]);
  });

  it('rejects an ignorable signal, not merely a missing property', () => {
    // SIGTERM is the default a child can trap — accepting any `killSignal`
    // accepts the exact failure the rule exists to prevent.
    expect(
      unboundedSpawnCalls("spawnSync('a', [], { timeout: 10, killSignal: 'SIGTERM' });\n", 'p.ts'),
    ).toEqual([1]);
  });
});
