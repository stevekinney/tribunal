import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import {
  hasForeignShebang,
  innermostBinding,
  isExtensionlessPath,
  isScannableFile,
  looksBinary,
  unwrapTransparent,
} from './banned-test-runner-imports';
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
//  3. It asserted on the file's *text*, so a file containing one compliant and
//     one unbounded call passed — both strings were present somewhere.
//  4. It then resolved options through a dataflow reader, and every resolver
//     added to read one more route became the surface for the next one to be
//     missing. It refuses to guess now: options it cannot read inline are
//     reported rather than resolved.
const here = dirname(fileURLToPath(import.meta.url));
const root =
  typeof (import.meta as { dir?: string }).dir === 'string'
    ? resolveRepositoryRoot()
    : join(here, '..', '..');

const NODE_CHILD_PROCESS = new Set(['node:child_process', 'child_process']);

/** Whether a call loads `node:child_process`, by either loader spelling. */
function loadsChildProcess(node: ts.Node): boolean {
  if (!ts.isCallExpression(node)) return false;
  const dynamic = node.expression.kind === ts.SyntaxKind.ImportKeyword;
  const required = ts.isIdentifier(node.expression) && node.expression.text === 'require';
  if (!dynamic && !required) return false;
  const specifier = node.arguments[0];
  return specifier !== undefined && ts.isStringLiteralLike(specifier)
    ? NODE_CHILD_PROCESS.has(specifier.text)
    : false;
}

/**
 * The names in one file that really refer to Node's spawner.
 *
 * Provenance, not spelling. Accepting any callee written `spawnSync` meant a
 * local `function spawnSync() {}` — application code with no subprocess in it —
 * failed this repository-wide invariant, which is the failure mode that gets a
 * guard routed around.
 *
 * `exported` carries what other tracked modules export as aliases, keyed by the
 * module that exports them, so a caller is recognised across a module boundary
 * without every relative import of a common name like `spawn` being treated as
 * the spawner.
 */
export function spawnAliasesIn(
  parsed: ts.SourceFile,
  exportsOf: (specifier: string) => ReadonlySet<string>,
): {
  direct: Map<string, ts.Identifier>;
  namespaces: Map<string, ts.Identifier>;
  exported: Set<string>;
} {
  // Keyed to the identifier that *binds* the name, so a call can be checked
  // against the binding rather than against the spelling: a file that really
  // imports `spawnSync` can still shadow it in a nested scope.
  const direct = new Map<string, ts.Identifier>();
  const namespaces = new Map<string, ts.Identifier>();
  const exported = new Set<string>();

  const fromSpecifier = (
    specifier: ts.Expression | undefined,
    imported: string,
  ): boolean | undefined => {
    if (specifier === undefined || !ts.isStringLiteralLike(specifier)) return undefined;
    if (NODE_CHILD_PROCESS.has(specifier.text)) return imported === 'spawnSync';
    return specifier.text.startsWith('.') ? exportsOf(specifier.text).has(imported) : false;
  };

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause?.namedBindings;
      if (clause !== undefined && ts.isNamedImports(clause)) {
        for (const element of clause.elements) {
          const imported = element.propertyName?.text ?? element.name.text;
          if (fromSpecifier(node.moduleSpecifier, imported) === true)
            direct.set(element.name.text, element.name);
        }
      }
      // `import * as cp from 'node:child_process'` binds the module object, and
      // `cp.spawnSync(...)` is the same call written through it.
      if (
        clause !== undefined &&
        ts.isNamespaceImport(clause) &&
        ts.isStringLiteralLike(node.moduleSpecifier) &&
        NODE_CHILD_PROCESS.has(node.moduleSpecifier.text)
      ) {
        namespaces.set(clause.name.text, clause.name);
      }
    }

    // The CommonJS spellings: `const { spawnSync } = require('node:child_process')`
    // binds the name, and `const cp = require('node:child_process')` binds the
    // module object. Dropping these while tightening provenance would have
    // traded a false positive for a false negative.
    if (ts.isVariableDeclaration(node) && node.initializer !== undefined) {
      if (loadsChildProcess(node.initializer)) {
        if (ts.isIdentifier(node.name)) namespaces.set(node.name.text, node.name);
        if (ts.isObjectBindingPattern(node.name)) {
          for (const element of node.name.elements) {
            const key =
              element.propertyName !== undefined && ts.isIdentifier(element.propertyName)
                ? element.propertyName.text
                : ts.isIdentifier(element.name)
                  ? element.name.text
                  : undefined;
            if (key === 'spawnSync' && ts.isIdentifier(element.name))
              direct.set(element.name.text, element.name);
          }
        }
      }
      // `const run = spawnSync` — an alias of a name already known to be one.
      if (
        ts.isIdentifier(node.name) &&
        ts.isIdentifier(node.initializer) &&
        direct.has(node.initializer.text)
      ) {
        direct.set(node.name.text, node.name);
      }
    }

    if (
      ts.isExportDeclaration(node) &&
      node.exportClause !== undefined &&
      ts.isNamedExports(node.exportClause)
    ) {
      for (const element of node.exportClause.elements) {
        const from = element.propertyName?.text ?? element.name.text;
        const viaModule = fromSpecifier(node.moduleSpecifier, from);
        if (viaModule === true || (viaModule === undefined && direct.has(from))) {
          exported.add(element.name.text);
        }
      }
    }
    // `export * from './spawner'` re-exports every alias that module exports.
    if (
      ts.isExportDeclaration(node) &&
      node.exportClause === undefined &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteralLike(node.moduleSpecifier) &&
      node.moduleSpecifier.text.startsWith('.')
    ) {
      for (const name of exportsOf(node.moduleSpecifier.text)) exported.add(name);
    }

    if (ts.isVariableStatement(node)) {
      const shared =
        node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) === true;
      if (shared) {
        for (const declaration of node.declarationList.declarations) {
          if (ts.isIdentifier(declaration.name) && direct.has(declaration.name.text)) {
            exported.add(declaration.name.text);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  // Twice, because `export { local as name }` can be written above the import
  // that binds `local`, and one pass in source order would miss it.
  visit(parsed);
  visit(parsed);
  return { direct, namespaces, exported };
}

/**
 * Which tracked file a relative specifier names, if any.
 *
 * A map lookup against the tracked set rather than real module resolution: the
 * extensions this repository uses, plus the directory-index form.
 */
function resolveSpecifier(
  fromPath: string,
  specifier: string,
  tracked: ReadonlySet<string>,
): string | undefined {
  const base = join(dirname(fromPath), specifier).replace(/\\/g, '/');
  const withoutExtension = base.replace(/\.(js|mjs|cjs)$/, '');
  for (const candidate of [
    base,
    ...['ts', 'tsx', 'mts', 'cts', 'js', 'mjs', 'cjs'].flatMap((extension) => [
      `${withoutExtension}.${extension}`,
      `${base}.${extension}`,
      `${base}/index.${extension}`,
    ]),
  ]) {
    if (tracked.has(candidate)) return candidate;
  }
  return undefined;
}

/**
 * Every name each tracked module exports as a `spawnSync` alias, by module.
 *
 * Keyed by the exporting module rather than pooled into one global set of
 * spellings. The pooled version was written as a deliberate trade — it bought
 * transitive re-exports without module resolution — but it made every relative
 * `import { spawn } from './anything'` look like the spawner once any module
 * anywhere exported that name, so an unrelated helper taking a `timeout` option
 * failed this invariant. A false positive in an always-on guard is the worse
 * defect, so the trade was the wrong way round.
 *
 * Grown to a fixpoint so a chain of re-exports is followed rather than one hop.
 * The set only grows and is bounded by the number of exported names.
 */
export function exportedSpawnAliases(files: ReadonlyMap<string, string>): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>();
  const tracked = new Set(files.keys());

  for (;;) {
    let grew = false;
    for (const [path, text] of files) {
      const parsed = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
      const exportsOf = (specifier: string): ReadonlySet<string> => {
        const resolved = resolveSpecifier(path, specifier, tracked);
        return (resolved === undefined ? undefined : index.get(resolved)) ?? new Set<string>();
      };
      const { exported } = spawnAliasesIn(parsed, exportsOf);
      if (exported.size === 0) continue;
      const known = index.get(path) ?? new Set<string>();
      for (const name of exported) {
        if (known.has(name)) continue;
        known.add(name);
        grew = true;
      }
      index.set(path, known);
    }
    if (!grew) return index;
  }
}

/**
 * The options a call passes must be written where this guard can read them.
 *
 * This replaces a dataflow resolver, and the replacement is a *contract*
 * change rather than a refactor: options reached through a name, a spread, a
 * preset, a branch, or an accessor are now **rejected** rather than resolved.
 * The remedy is to write the object inline at the call, which is the form all
 * seven of this repository's real spawn calls already use.
 *
 * The reasoning, recorded because the previous approach was defended for
 * several rounds before it was abandoned. Resolving "what does this options
 * value hold" is open-ended in JavaScript — a value can arrive through
 * bindings, spreads, member reads, branches, writes after creation, and
 * accessors — and each resolver added to read one more route became surface
 * for the next one to be missing. Fifteen findings against that resolver were
 * filed and fixed on this branch, and the last cycle produced six more in the
 * code written to close the previous six. The fix surface *was* the finding
 * surface.
 *
 * A guard that refuses to guess has neither problem. Anything it cannot read
 * is reported, so a false negative is impossible by construction rather than
 * by exhaustion; the cost is that a legitimate shared preset is rejected, and
 * that cost is paid by inlining the literal. What was bought with a hundred
 * lines and fifteen findings is now bought with a rule.
 */
type OptionsReading =
  | { kind: 'compliant' }
  | { kind: 'unreadable'; because: string }
  | { kind: 'unbounded'; because: string };

const SIGKILL = 'SIGKILL';

/** The name a property declares, when it is written as a constant. */
function staticPropertyName(name: ts.PropertyName | undefined): string | undefined {
  if (name === undefined) return undefined;
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  if (!ts.isComputedPropertyName(name)) return undefined;
  const key = unwrapTransparent(name.expression);
  return ts.isStringLiteralLike(key) || ts.isNumericLiteral(key) ? key.text : undefined;
}

/** Whether an options literal pairs its deadline with a non-ignorable signal. */
function readOptions(options: ts.ObjectLiteralExpression): OptionsReading {
  let deadline = false;
  let signal: string | undefined;

  for (const property of options.properties) {
    // A spread can carry a `timeout` in from anywhere, so an object containing
    // one cannot be certified at all.
    if (ts.isSpreadAssignment(property)) {
      return { kind: 'unreadable', because: 'a spread can carry a deadline in from elsewhere' };
    }
    const key = staticPropertyName(property.name);
    if (key === undefined) {
      return { kind: 'unreadable', because: 'a computed key that is not a constant' };
    }
    if (key === 'timeout') {
      // An accessor counts: Node reads it and applies whatever it returns, so
      // a `get timeout()` is a deadline even though its value is not knowable.
      deadline = true;
      continue;
    }
    if (key !== 'killSignal') continue;
    // The *value* matters, not the property. `killSignal: 'SIGTERM'` is the
    // default a child can trap, which is the exact failure the rule prevents.
    // `'SIGKILL' as const` is the same literal wearing a wrapper.
    if (!ts.isPropertyAssignment(property)) {
      return { kind: 'unreadable', because: 'a killSignal that is not written as a literal' };
    }
    const value = unwrapTransparent(property.initializer);
    if (!ts.isStringLiteralLike(value)) {
      return { kind: 'unreadable', because: 'a killSignal that is not written as a literal' };
    }
    signal = value.text;
  }

  if (!deadline) return { kind: 'compliant' };
  return signal === SIGKILL
    ? { kind: 'compliant' }
    : { kind: 'unbounded', because: `timeout without killSignal: '${SIGKILL}'` };
}

export function unboundedSpawnCalls(
  source: string,
  fileName: string,
  index: ReadonlyMap<string, Set<string>> = new Map(),
  tracked: ReadonlySet<string> = new Set(index.keys()),
): number[] {
  const parsed = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const offenders: number[] = [];

  const exportsOf = (specifier: string): ReadonlySet<string> => {
    const resolved = resolveSpecifier(fileName, specifier, tracked);
    return (resolved === undefined ? undefined : index.get(resolved)) ?? new Set<string>();
  };
  const { direct, namespaces } = spawnAliasesIn(parsed, exportsOf);

  /**
   * Whether a callee really is Node's spawner, by provenance and by binding.
   *
   * Provenance alone was not enough: a file that genuinely imports `spawnSync`
   * can shadow the name in a nested scope, and `function run(spawnSync) { … }`
   * is then ordinary application code. The callee's binding has to be the
   * binding the import created, which both sides resolve through the same
   * function so they agree by construction.
   */
  const isSpawner = (callee: ts.Node): boolean => {
    if (ts.isIdentifier(callee)) {
      const bound = direct.get(callee.text);
      return (
        bound !== undefined &&
        innermostBinding(callee, callee.text, true) === innermostBinding(bound, callee.text, true)
      );
    }
    if (!ts.isPropertyAccessExpression(callee)) return false;
    if (callee.name.text !== 'spawnSync') return false;
    if (!ts.isIdentifier(callee.expression)) return false;
    const receiver = callee.expression;
    if (receiver.text === 'Bun') return true;
    const bound = namespaces.get(receiver.text);
    return (
      bound !== undefined &&
      innermostBinding(receiver, receiver.text, true) ===
        innermostBinding(bound, receiver.text, true)
    );
  };

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      // `spawnSync.call(thisArg, …)` shifts every argument one place right and
      // `.apply` wraps them in a list. Both really invoke the spawner, so
      // reading the call's own argument list answers the wrong question.
      const forwarder =
        ts.isPropertyAccessExpression(callee) &&
        (callee.name.text === 'call' || callee.name.text === 'apply')
          ? callee
          : undefined;
      const target = forwarder === undefined ? callee : forwarder.expression;

      if (isSpawner(target)) {
        const forwarded =
          forwarder === undefined
            ? [...node.arguments]
            : forwarder.name.text === 'call'
              ? node.arguments.slice(1)
              : (() => {
                  const list = node.arguments[1];
                  return list !== undefined && ts.isArrayLiteralExpression(list)
                    ? [...list.elements]
                    : [];
                })();

        // Where the options sit. Node accepts `(command, args, options)` and
        // `(command, options)`; Bun's only form is the second, and its first
        // argument is the command rather than an argument list.
        //
        // Index one is read as options only when it is written as an object
        // literal, because `spawnSync(command, args)` with a *named* argument
        // list is ordinary code and reporting it would be a false positive on
        // the common shape. The residual is stated rather than left to be
        // found: Node's two-argument overload with a *named* options object —
        // `spawnSync('tool', settings)` — is read as an argument list and so
        // passes. Closing it would report every `spawnSync(command, args)`,
        // which is the worse trade.
        const isBun =
          ts.isPropertyAccessExpression(target) &&
          ts.isIdentifier(target.expression) &&
          target.expression.text === 'Bun';
        const first = forwarded[1] === undefined ? undefined : unwrapTransparent(forwarded[1]);
        const second = forwarded[2] === undefined ? undefined : unwrapTransparent(forwarded[2]);
        const optionsArgument =
          second ??
          (isBun || (first !== undefined && ts.isObjectLiteralExpression(first))
            ? first
            : undefined);

        if (optionsArgument !== undefined) {
          const reading = ts.isObjectLiteralExpression(optionsArgument)
            ? readOptions(optionsArgument)
            : ({
                kind: 'unreadable',
                because: 'options that are not written inline at the call',
              } as const);
          if (reading.kind !== 'compliant') {
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

const READABLE_MODES = new Set(['100644', '100755']);
const tracked = execFileSync('git', ['ls-files', '-z', '--stage'], {
  cwd: root,
  encoding: 'utf8',
  maxBuffer: 32 * 1024 * 1024,
})
  .split('\0')
  .filter((entry) => entry.length > 0)
  .flatMap((entry) => {
    const separator = entry.indexOf('\t');
    if (separator < 0) return [];
    return READABLE_MODES.has(entry.slice(0, entry.indexOf(' ')))
      ? [entry.slice(separator + 1)]
      : [];
  });

/**
 * Which tracked paths hold JavaScript, decided by the sibling module's own
 * classifier rather than by a second extension list here.
 *
 * An extension regex dropped every extensionless entrypoint, so `bin/release`
 * could call `spawnSync` without a deadline and never reach this invariant —
 * while the companion scanner explicitly supports those files and documents
 * that `bun bin/run-tests` is one. Reusing `isScannableFile` and the shebang
 * reader keeps one answer to "is this JavaScript" across both guards.
 */
export function isInspectableSource(path: string, text: string): boolean {
  if (!isScannableFile(path)) return false;
  if (looksBinary(text)) return false;
  // An extensionless path is JavaScript only if its shebang says so; the
  // sibling scanner decides that, rather than a second reader here.
  return !(isExtensionlessPath(path) && hasForeignShebang(text));
}

const sources = new Map(
  tracked
    .map((path) => [path, readFileSync(join(root, path), 'utf8')] as const)
    .filter(([path, text]) => isInspectableSource(path, text)),
);

const repositoryAliases = exportedSpawnAliases(sources);
const trackedPaths = new Set(sources.keys());

// Every source is inspected. Selecting files by whether their text mentions the
// spawner was itself a hole — a module can re-export it under another name, and
// its caller then mentions it nowhere.
const spawners = [...sources]
  .filter(([path, text]) => unboundedSpawnCallsFinds(path, text))
  .map(([path]) => path)
  .sort();

/** Whether a file contains any call this guard recognises as the spawner. */
function unboundedSpawnCallsFinds(path: string, text: string): boolean {
  const parsed = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  const exportsOf = (specifier: string): ReadonlySet<string> => {
    const resolved = resolveSpecifier(path, specifier, trackedPaths);
    return (resolved === undefined ? undefined : repositoryAliases.get(resolved)) ?? new Set();
  };
  const { direct, namespaces } = spawnAliasesIn(parsed, exportsOf);
  if (direct.size === 0 && namespaces.size === 0 && !text.includes('Bun.spawnSync')) return false;
  return true;
}

/**
 * A fixture with provenance, reported in the fixture's own line numbers.
 *
 * Every call must now resolve to a real `node:child_process` binding, because
 * a callee merely *spelled* `spawnSync` is ordinary application code and
 * failing the repository over one is the defect that gets a guard routed
 * around. Each fixture therefore carries the import that makes it the spawner,
 * and the prefix is subtracted from the reported lines so the expectations
 * below still read against the source as written.
 */

/**
 * A fixture with provenance, reported in the fixture's own line numbers.
 *
 * A callee merely *spelled* `spawnSync` is ordinary application code, so each
 * fixture carries the import that makes it the spawner and the prefix is
 * subtracted from the reported lines.
 */
const IMPORTED = "import { spawnSync } from 'node:child_process';";
const unbounded = (source: string | string[], fileName = 'p.ts'): number[] =>
  unboundedSpawnCalls(
    [IMPORTED, ...(Array.isArray(source) ? source : [source])].join('\n'),
    fileName,
  ).map((line) => line - 1);

describe('every subprocess deadline is enforceable', () => {
  it('enumerates the spawners rather than trusting a list', () => {
    expect(spawners.length).toBeGreaterThan(0);
  });

  it.each(spawners)('%s bounds every deadline it sets', (relativePath) => {
    const source = sources.get(relativePath) ?? '';
    expect(unboundedSpawnCalls(source, relativePath, repositoryAliases, trackedPaths)).toEqual([]);
  });

  it('admits runnable extensionless entrypoints, not only known extensions', () => {
    // An extension regex dropped every extensionless path, so `bin/release`
    // could set a deadline without `SIGKILL` and never reach this invariant.
    // This repository tracks none, so the widening is unprovable against the
    // tree; the predicate is asserted directly instead.
    expect(isInspectableSource('bin/release', '#!/usr/bin/env bun\nspawnSync();\n')).toBe(true);
    expect(isInspectableSource('bin/deploy.sh', '#!/bin/sh\necho hi\n')).toBe(false);
    expect(isInspectableSource('bin/tool', '#!/usr/bin/env python3\nprint(1)\n')).toBe(false);
    expect(isInspectableSource('a.ts', 'export const x = 1;\n')).toBe(true);
    expect(isInspectableSource('logo.svg', '<svg/>\n')).toBe(false);
  });

  it('accepts an inline deadline paired with a non-ignorable signal', () => {
    expect(unbounded("spawnSync('a', [], { timeout: 10, killSignal: 'SIGKILL' });")).toEqual([]);
    // The wrappers that erase at run time leave the same literal behind.
    expect(
      unbounded("spawnSync('a', [], { timeout: 10, killSignal: 'SIGKILL' as const });"),
    ).toEqual([]);
    expect(
      unbounded("spawnSync('a', [], { timeout: 10, killSignal: 'SIGKILL' } satisfies object);"),
    ).toEqual([]);
    // A key names the same property however it is spelled.
    expect(unbounded("spawnSync('a', [], { 'timeout': 10, ['killSignal']: 'SIGKILL' });")).toEqual(
      [],
    );
  });

  it('reports a deadline that is unpaired or paired with an ignorable signal', () => {
    expect(unbounded("spawnSync('a', [], { timeout: 10 });")).toEqual([1]);
    // SIGTERM is the default a child can trap — the exact failure the rule
    // exists to prevent.
    expect(unbounded("spawnSync('a', [], { timeout: 10, killSignal: 'SIGTERM' });")).toEqual([1]);
    // Node reads a `get timeout()` and applies what it returns, so an accessor
    // is a deadline even though its value is not knowable here.
    expect(unbounded("spawnSync('a', [], { get timeout() { return 10; } });")).toEqual([1]);
  });

  it('accepts a call that sets no deadline at all', () => {
    expect(unbounded("spawnSync('a', []);")).toEqual([]);
    expect(unbounded("spawnSync('a', [], { stdio: 'inherit' });")).toEqual([]);
  });

  it('refuses to certify options it cannot read, rather than guessing', () => {
    // This is the contract, not an accident. Every one of these was previously
    // resolved by a dataflow reader, and each resolver added to read one more
    // route became the surface for the next one to be missing. Fifteen
    // findings against that reader were filed and fixed on this branch, and
    // the last cycle produced six more inside the code written to close the
    // previous six. Refusing to guess makes a false negative impossible by
    // construction; the remedy for a rejection is to write the object inline.
    for (const fixture of [
      // Held in a name.
      ['const options = { timeout: 10, killSignal: SIG };', "spawnSync('a', [], options);"],
      // Assembled by spreading.
      ['const base = { timeout: 10 };', "spawnSync('a', [], { ...base, killSignal: 'SIGKILL' });"],
      // Chosen by a branch.
      ["spawnSync('a', [], flag ? { timeout: 10, killSignal: 'SIGKILL' } : other);"],
      // A signal that is not written as a literal.
      ["const signal = 'SIGKILL';", "spawnSync('a', [], { timeout: 10, killSignal: signal });"],
      // A signal behind an accessor.
      ["spawnSync('a', [], { timeout: 10, get killSignal() { return 'SIGKILL'; } });"],
      // A key that is not a constant.
      ['declare const key: string;', "spawnSync('a', [], { timeout: 10, [key]: 'SIGKILL' });"],
    ]) {
      expect(unbounded(fixture), fixture.join(' ')).not.toEqual([]);
    }
  });

  it('requires provenance, not a matching name', () => {
    // A local helper spelled `spawnSync` is application code with no
    // subprocess in it. Accepting the spelling made this always-on invariant
    // reject valid changes, which is worse than missing a call.
    expect(
      unboundedSpawnCalls(
        "function spawnSync() {}\nspawnSync('x', [], { timeout: 10 });\n",
        'p.ts',
      ),
    ).toEqual([]);
    // A real import shadowed in a nested scope is that scope's binding, not
    // the spawner — so the check is on the binding, not on the spelling.
    expect(unbounded("function run(spawnSync) { spawnSync('x', [], { timeout: 10 }); }")).toEqual(
      [],
    );
    // Every route that really is Node's spawner still counts.
    expect(
      unboundedSpawnCalls(
        "const { spawnSync } = require('node:child_process');\nspawnSync('x', [], { timeout: 10 });\n",
        'p.ts',
      ),
    ).toEqual([2]);
    expect(
      unboundedSpawnCalls(
        "import * as cp from 'node:child_process';\ncp.spawnSync('x', [], { timeout: 10 });\n",
        'p.ts',
      ),
    ).toEqual([2]);
    expect(
      unboundedSpawnCalls(
        "const cp = require('node:child_process');\ncp.spawnSync('x', [], { timeout: 10 });\n",
        'p.ts',
      ),
    ).toEqual([2]);
    expect(
      unboundedSpawnCalls(
        "import { spawnSync as spawn } from 'node:child_process';\nspawn('x', [], { timeout: 10 });\n",
        'p.ts',
      ),
    ).toEqual([2]);
    expect(unbounded(['const run = spawnSync;', "run('x', [], { timeout: 10 });"])).toEqual([2]);
  });

  it('reads both spawnSync signatures rather than classifying the argument list', () => {
    // Node takes `(command, args, options)` *and* `(command, options)`; Bun
    // takes only the second, and its first argument is the command rather than
    // an argument list.
    expect(unboundedSpawnCalls('Bun.spawnSync(cmd, { timeout: 10 });\n', 'p.ts')).toEqual([1]);
    expect(
      unboundedSpawnCalls("Bun.spawnSync(cmd, { timeout: 10, killSignal: 'SIGKILL' });\n", 'p.ts'),
    ).toEqual([]);
    // Bun's options position is unambiguous, so a name there is unreadable.
    expect(unboundedSpawnCalls('Bun.spawnSync(cmd, options);\n', 'p.ts')).toEqual([1]);
    expect(unbounded("spawnSync('tool', { timeout: 10 });")).toEqual([1]);
    expect(unbounded("spawnSync('tool', { timeout: 10, killSignal: 'SIGKILL' });")).toEqual([]);
    // A *named* argument list is an argument list, not unreadable options —
    // reporting it would be a false positive on the common shape.
    expect(unbounded("spawnSync('tool', args);")).toEqual([]);
  });

  it('follows the spawner through call and apply', () => {
    expect(unbounded("spawnSync.call(null, 'x', [], { timeout: 10 });")).toEqual([1]);
    expect(unbounded("spawnSync.apply(null, ['x', [], { timeout: 10 }]);")).toEqual([1]);
    expect(
      unbounded("spawnSync.call(null, 'x', [], { timeout: 10, killSignal: 'SIGKILL' });"),
    ).toEqual([]);
  });

  it('catches an unbounded call sitting beside a compliant one', () => {
    expect(
      unbounded([
        "spawnSync('a', [], { timeout: 10, killSignal: 'SIGKILL' });",
        "spawnSync('b', [], { timeout: 10 });",
      ]),
    ).toEqual([2]);
  });

  it('recognises a spawner reached through another module, by that module', () => {
    // The caller mentions `spawnSync` nowhere, so a text filter excluded it
    // before any AST was built.
    const files = new Map([
      ['spawner.ts', "export { spawnSync as spawn } from 'node:child_process';"],
      ['caller.ts', "import { spawn } from './spawner';\nspawn('x', [], { timeout: 10 });"],
    ]);
    const index = exportedSpawnAliases(files);
    expect([...(index.get('spawner.ts') ?? [])]).toEqual(['spawn']);
    expect(
      unboundedSpawnCalls(files.get('caller.ts') ?? '', 'caller.ts', index, new Set(files.keys())),
    ).toEqual([2]);
    expect(unboundedSpawnCalls(files.get('caller.ts') ?? '', 'caller.ts')).toEqual([]);
  });

  it('follows a chain of re-exports, and a star re-export', () => {
    const files = new Map([
      ['a.ts', "export { spawnSync as spawn } from 'node:child_process';"],
      ['b.ts', "export { spawn as launch } from './a';"],
      ['c.ts', "import { launch } from './b';\nlaunch('x', [], { timeout: 10 });"],
      ['d.ts', "export * from './a';"],
      ['e.ts', "import { spawn } from './d';\nspawn('x', [], { timeout: 10 });"],
    ]);
    const index = exportedSpawnAliases(files);
    const tracked = new Set(files.keys());
    expect(unboundedSpawnCalls(files.get('c.ts') ?? '', 'c.ts', index, tracked)).toEqual([2]);
    expect(unboundedSpawnCalls(files.get('e.ts') ?? '', 'e.ts', index, tracked)).toEqual([2]);
  });

  it('keeps alias provenance attached to the exporting module', () => {
    // A global set of alias *spellings* made every relative import of a common
    // name look like the spawner once any module anywhere exported it.
    const files = new Map([
      ['spawner.ts', "export { spawnSync as spawn } from 'node:child_process';"],
      ['pty.ts', 'export function spawn(cmd, args, options) { return cmd; }'],
      ['good.ts', "import { spawn } from './spawner';\nspawn('x', [], { timeout: 10 });"],
      ['unrelated.ts', "import { spawn } from './pty';\nspawn('x', [], { timeout: 10 });"],
    ]);
    const index = exportedSpawnAliases(files);
    const tracked = new Set(files.keys());
    expect(unboundedSpawnCalls(files.get('good.ts') ?? '', 'good.ts', index, tracked)).toEqual([2]);
    expect(
      unboundedSpawnCalls(files.get('unrelated.ts') ?? '', 'unrelated.ts', index, tracked),
    ).toEqual([]);
  });
});
