import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import {
  aliasInitializers,
  hasForeignShebang,
  innermostBinding,
  isExtensionlessPath,
  isScannableFile,
  looksBinary,
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
//  3. It asserted on the file's *text*, so a file containing one compliant call
//     and one unbounded call passed — both strings were present somewhere. Each
//     call is inspected on its own now.
const here = dirname(fileURLToPath(import.meta.url));
const root =
  typeof (import.meta as { dir?: string }).dir === 'string'
    ? resolveRepositoryRoot()
    : join(here, '..', '..');

/**
 * Names are resolved through their lexical binding, not by searching the file
 * for matching text.
 *
 * The text search this replaces made the answer depend on unrelated
 * declaration order: an outer `const options` written *after* a function that
 * declares its own could supply the value for the inner call. Binding
 * resolution already exists in `banned-test-runner-imports.ts`, is exercised by
 * hundreds of tests there, and is imported rather than reimplemented — a
 * second, weaker copy of a rule the sibling module already owns is the
 * duplication this pair of guards keeps being corrected for.
 */

/** A string constant, resolved through the binding when it is held in a name. */
function constantString(
  node: ts.Node | undefined,
  seen: ReadonlySet<ts.Node> = new Set(),
): string | undefined {
  if (node === undefined || seen.has(node)) return undefined;
  if (ts.isStringLiteralLike(node)) return node.text;
  if (!ts.isIdentifier(node)) return undefined;
  const guarded = new Set([...seen, node]);
  for (const initializer of aliasInitializers(node)) {
    const resolved = constantString(initializer, guarded);
    if (resolved !== undefined) return resolved;
  }
  return undefined;
}

/**
 * Every object literal an options argument can be.
 *
 * A list rather than one answer, because `flag ? strict : lenient` can be
 * either and which runs is not knowable — so both are candidates and an
 * unbounded one is a violation.
 */
function resolveOptions(
  node: ts.Node | undefined,
  seen: ReadonlySet<ts.Node> = new Set(),
): readonly ts.ObjectLiteralExpression[] {
  if (node === undefined || seen.has(node)) return [];
  const guarded = new Set([...seen, node]);

  if (ts.isObjectLiteralExpression(node)) return [node];

  if (ts.isConditionalExpression(node)) {
    return [...resolveOptions(node.whenTrue, guarded), ...resolveOptions(node.whenFalse, guarded)];
  }
  if (
    ts.isBinaryExpression(node) &&
    (node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
      node.operatorToken.kind === ts.SyntaxKind.BarBarToken)
  ) {
    return [...resolveOptions(node.left, guarded), ...resolveOptions(node.right, guarded)];
  }

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
    return resolveOptions(node.arguments[0], guarded);
  }

  // A name yields every value its binding receives — the declaration's
  // initializer, a deferred assignment, a parameter default — because that is
  // what `aliasInitializers` already collects, scope-correctly.
  if (ts.isIdentifier(node)) {
    return aliasInitializers(node).flatMap((initializer) => resolveOptions(initializer, guarded));
  }

  if (ts.isElementAccessExpression(node) && ts.isNumericLiteral(node.argumentExpression)) {
    const index = Number(node.argumentExpression.text);
    return resolveList(node.expression, guarded).flatMap((list) =>
      resolveOptions(list.elements[index], guarded),
    );
  }

  // Both spellings of a member read call the same function, so recognising
  // only the dotted one is bypassed by writing the bracketed one.
  const key = ts.isPropertyAccessExpression(node)
    ? node.name.text
    : ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)
      ? node.argumentExpression.text
      : undefined;
  if (key === undefined) return [];

  return resolveOptions((node as ts.PropertyAccessExpression).expression, guarded)
    .map((receiver) =>
      receiver.properties.find(
        (candidate) =>
          candidate.name !== undefined &&
          ts.isIdentifier(candidate.name) &&
          candidate.name.text === key,
      ),
    )
    .flatMap((property) =>
      property !== undefined && ts.isPropertyAssignment(property)
        ? resolveOptions(property.initializer, guarded)
        : [],
    );
}

/** The array literals an expression names, resolved the same way options are. */
function resolveList(
  node: ts.Node,
  seen: ReadonlySet<ts.Node>,
): readonly ts.ArrayLiteralExpression[] {
  if (seen.has(node)) return [];
  if (ts.isArrayLiteralExpression(node)) return [node];
  if (ts.isIdentifier(node)) {
    const guarded = new Set([...seen, node]);
    return aliasInitializers(node).flatMap((initializer) => resolveList(initializer, guarded));
  }
  return [];
}

/**
 * The properties an options object actually has at run time, spreads resolved.
 *
 * Later properties win, exactly as they do at run time, so
 * `{ ...deadline, killSignal: 'SIGTERM' }` reads as SIGTERM rather than as
 * whatever the spread supplied.
 */
function flattenedProperties(
  options: ts.ObjectLiteralExpression,
  seen: ReadonlySet<ts.Node> = new Set(),
): Map<string, ts.Expression> {
  const properties = new Map<string, ts.Expression>();
  if (seen.has(options)) return properties;
  const guarded = new Set([...seen, options]);
  for (const property of options.properties) {
    if (ts.isSpreadAssignment(property)) {
      for (const spread of resolveOptions(property.expression, guarded)) {
        for (const [name, value] of flattenedProperties(spread, guarded))
          properties.set(name, value);
      }
      continue;
    }
    if (property.name === undefined || !ts.isIdentifier(property.name)) continue;
    // A method or accessor named `timeout` is not a deadline; the value is what
    // the checks read, so it is resolved once here.
    const value = ts.isPropertyAssignment(property)
      ? property.initializer
      : ts.isShorthandPropertyAssignment(property)
        ? property.name
        : undefined;
    if (value !== undefined) properties.set(property.name.text, value);
  }
  return properties;
}

/**
 * Properties written onto a named options object after it was created.
 *
 * `const options = {}; options.timeout = 10` sets a deadline that reading the
 * literal alone cannot see. The search covers the whole file and is filtered by
 * *binding identity*, not by spelling — otherwise a parameter named `options`
 * inside an unrelated function merges its `killSignal` into the outer object
 * and an unbounded call reads as compliant. Both spellings of the write are
 * accepted, since `options['timeout'] = 10` sets the same property.
 */
function assignedProperties(receiver: ts.Identifier): Map<string, ts.Expression> {
  const properties = new Map<string, ts.Expression>();
  const binding = innermostBinding(receiver, receiver.text, true);
  const visit = (node: ts.Node): void => {
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const target = node.left;
      const owner =
        ts.isPropertyAccessExpression(target) || ts.isElementAccessExpression(target)
          ? target.expression
          : undefined;
      const key = ts.isPropertyAccessExpression(target)
        ? target.name.text
        : ts.isElementAccessExpression(target) && ts.isStringLiteralLike(target.argumentExpression)
          ? target.argumentExpression.text
          : undefined;
      if (
        key !== undefined &&
        owner !== undefined &&
        ts.isIdentifier(owner) &&
        owner.text === receiver.text &&
        innermostBinding(owner, owner.text, true) === binding
      ) {
        properties.set(key, node.right);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(receiver.getSourceFile());
  return properties;
}

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
): { direct: Set<string>; namespaces: Set<string>; exported: Set<string> } {
  const direct = new Set<string>();
  const namespaces = new Set<string>();
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
          if (fromSpecifier(node.moduleSpecifier, imported) === true) direct.add(element.name.text);
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
        namespaces.add(clause.name.text);
      }
    }

    // The CommonJS spellings: `const { spawnSync } = require('node:child_process')`
    // binds the name, and `const cp = require('node:child_process')` binds the
    // module object. Dropping these while tightening provenance would have
    // traded a false positive for a false negative.
    if (ts.isVariableDeclaration(node) && node.initializer !== undefined) {
      if (loadsChildProcess(node.initializer)) {
        if (ts.isIdentifier(node.name)) namespaces.add(node.name.text);
        if (ts.isObjectBindingPattern(node.name)) {
          for (const element of node.name.elements) {
            const key =
              element.propertyName !== undefined && ts.isIdentifier(element.propertyName)
                ? element.propertyName.text
                : ts.isIdentifier(element.name)
                  ? element.name.text
                  : undefined;
            if (key === 'spawnSync' && ts.isIdentifier(element.name)) direct.add(element.name.text);
          }
        }
      }
      // `const run = spawnSync` — an alias of a name already known to be one.
      if (
        ts.isIdentifier(node.name) &&
        ts.isIdentifier(node.initializer) &&
        direct.has(node.initializer.text)
      ) {
        direct.add(node.name.text);
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

  /** Whether a callee really is Node's spawner, by provenance rather than spelling. */
  const isSpawner = (callee: ts.Node): boolean => {
    if (ts.isIdentifier(callee)) return direct.has(callee.text);
    if (!ts.isPropertyAccessExpression(callee)) return false;
    if (callee.name.text !== 'spawnSync') return false;
    if (!ts.isIdentifier(callee.expression)) return false;
    return callee.expression.text === 'Bun' || namespaces.has(callee.expression.text);
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

        // Node accepts both `spawnSync(command, args, options)` and
        // `spawnSync(command, options)`; Bun's only form is the second. Rather
        // than classify the argument list, both positions are read and every
        // object literal either resolves to is a candidate — an args array
        // never resolves to one, so it contributes nothing. That collapses
        // three overloads into one reader with no signature table to keep
        // correct.
        const candidateArguments = [forwarded[1], forwarded[2]];
        const written = candidateArguments
          .filter(
            (argument): argument is ts.Identifier =>
              argument !== undefined && ts.isIdentifier(argument),
          )
          .map((argument) => assignedProperties(argument));
        const resolved = candidateArguments.flatMap((argument) => resolveOptions(argument));
        const objects: (ts.ObjectLiteralExpression | undefined)[] =
          resolved.length > 0 ? resolved : written.some((map) => map.size > 0) ? [undefined] : [];

        for (const options of objects) {
          const properties = new Map<string, ts.Expression>([
            ...(options === undefined ? [] : flattenedProperties(options)),
            ...written.flatMap((map) => [...map]),
          ]);
          const deadline = properties.get('timeout');
          // The *value* matters, not the property. `killSignal: 'SIGTERM'` is
          // the default a child can trap, so accepting any signal accepts the
          // very thing the rule exists to prevent.
          if (
            deadline !== undefined &&
            constantString(properties.get('killSignal')) !== 'SIGKILL'
          ) {
            offenders.push(parsed.getLineAndCharacterOfPosition(node.getStart()).line + 1);
            break;
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return offenders;
}

// `--stage` so entries can be filtered by mode rather than by guessing from
// the path. This repository tracks `.claude/skills/tensorlake` as a symlink
// (mode 120000) pointing at a directory, and reading it follows the link and
// throws EISDIR. Gitlinks (160000) have no file behind them at all. The
// previous extension filter hid both by excluding every extensionless path,
// which is exactly the exclusion this guard is removing — so widening the
// selection means handling what the wider set actually contains.
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

  it('admits runnable extensionless entrypoints, not only known extensions', () => {
    // An extension regex dropped every extensionless path, so `bin/release`
    // could set a deadline without `SIGKILL` and never reach this invariant —
    // while the companion scanner supports those files and documents that
    // `bun bin/run-tests` is one. This repository currently tracks none, so the
    // widening is unprovable against the tree itself; the predicate is asserted
    // directly instead of leaving it untested.
    expect(isInspectableSource('bin/release', '#!/usr/bin/env bun\nspawnSync();\n')).toBe(true);
    expect(isInspectableSource('bin/deploy.sh', '#!/bin/sh\necho hi\n')).toBe(false);
    expect(isInspectableSource('bin/tool', '#!/usr/bin/env python3\nprint(1)\n')).toBe(false);
    expect(isInspectableSource('a.ts', 'export const x = 1;\n')).toBe(true);
    expect(isInspectableSource('logo.svg', '<svg/>\n')).toBe(false);
  });

  it.each(spawners)('%s bounds every deadline it sets', (relativePath) => {
    const source = sources.get(relativePath) ?? '';
    expect(unboundedSpawnCalls(source, relativePath, repositoryAliases, trackedPaths)).toEqual([]);
  });

  it('catches an unbounded call sitting beside a compliant one', () => {
    // The failure the original text-based version missed: both strings are
    // present in the file, so a whole-file assertion passed.
    expect(
      unbounded([
        "spawnSync('a', [], { timeout: 10, killSignal: 'SIGKILL' });",
        "spawnSync('b', [], { timeout: 10 });",
      ]),
    ).toEqual([2]);
  });

  it('accepts a call that sets no deadline at all', () => {
    expect(unbounded("spawnSync('a', []);")).toEqual([]);
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
    expect(unbounded(['const run = spawnSync;', "run('x', [], { timeout: 10 });"])).toEqual([2]);
  });

  it('reads both spawnSync signatures rather than classifying the argument list', () => {
    // Node takes `(command, args, options)` *and* `(command, options)`; Bun
    // takes only the second. Always reading index 2 meant this guard never
    // inspected the repository's own spawner, which is a `Bun.spawnSync` call,
    // and reading index 1 only for Bun missed Node's own optional-args
    // overload. Both positions are read and every object literal either
    // resolves to is a candidate — an args array never resolves to one, so it
    // contributes nothing.
    expect(unboundedSpawnCalls('Bun.spawnSync(cmd, { timeout: 10 });\n', 'p.ts')).toEqual([1]);
    expect(
      unboundedSpawnCalls("Bun.spawnSync(cmd, { timeout: 10, killSignal: 'SIGKILL' });\n", 'p.ts'),
    ).toEqual([]);
    expect(unbounded("spawnSync('tool', { timeout: 10 });")).toEqual([1]);
    expect(unbounded("spawnSync('tool', { timeout: 10, killSignal: 'SIGKILL' });")).toEqual([]);
    expect(unbounded("spawnSync('tool', [], { timeout: 10 });")).toEqual([1]);
  });

  it('follows an aliased spawnSync import', () => {
    const source = [
      "import { spawnSync as spawn } from 'node:child_process';",
      "spawn('x', [], { timeout: 10 });",
    ].join('\n');
    expect(unboundedSpawnCalls(source, 'p.ts')).toEqual([2]);
  });

  it('resolves options held in a variable, and through its lexical binding', () => {
    // Looking only for an inline literal found nothing to inspect and called
    // the deadline compliant.
    expect(unbounded(['const options = { timeout: 10 };', "spawnSync('x', [], options);"])).toEqual(
      [2],
    );
    // Resolving by *text* made the answer depend on unrelated declaration
    // order: an outer object written after the function supplied the value for
    // a call that JavaScript resolves to the function-local one.
    expect(
      unbounded([
        "function run() { const options = { timeout: 10 }; spawnSync('x', [], options); }",
        "const options = { timeout: 10, killSignal: 'SIGKILL' };",
      ]),
    ).toEqual([1]);
    // A name that receives its value later is still that name's value.
    expect(
      unbounded(['let options;', 'options = { timeout: 10 };', "spawnSync('x', [], options);"]),
    ).toEqual([3]);
  });

  it('resolves a deadline supplied through a spread', () => {
    expect(
      unbounded(['const deadline = { timeout: 10 };', "spawnSync('x', [], { ...deadline });"]),
    ).toEqual([2]);
    expect(
      unbounded([
        "const deadline = { timeout: 10, killSignal: 'SIGKILL' };",
        "spawnSync('x', [], { ...deadline });",
      ]),
    ).toEqual([]);
  });

  it('lets a later property override what a spread supplied, as the runtime does', () => {
    expect(
      unbounded([
        "const deadline = { timeout: 10, killSignal: 'SIGKILL' };",
        "spawnSync('x', [], { ...deadline, killSignal: 'SIGTERM' });",
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
    // Without the index the caller is invisible, which is the state this guard
    // was in.
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
    // name look like the spawner once any module anywhere exported it, so an
    // unrelated helper taking a `timeout` option failed the repository. The
    // index is keyed by exporting module instead.
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

  it('reads a signal held in a name, or written in shorthand', () => {
    // Both are compliant code the earlier reader called unbounded. A guard that
    // fails the suite over correct source teaches people to route around it.
    expect(
      unbounded([
        "const killSignal = 'SIGKILL';",
        "spawnSync('x', [], { timeout: 10, killSignal });",
      ]),
    ).toEqual([]);
    expect(
      unbounded([
        "const signal = 'SIGKILL';",
        "spawnSync('x', [], { timeout: 10, killSignal: signal });",
      ]),
    ).toEqual([]);
    expect(
      unbounded([
        "const signal = 'SIGTERM';",
        "spawnSync('x', [], { timeout: 10, killSignal: signal });",
      ]),
    ).toEqual([2]);
  });

  it('resolves options reached through a key, in either spelling', () => {
    expect(
      unbounded([
        'const presets = { strict: { timeout: 10 } };',
        "spawnSync('x', [], presets.strict);",
      ]),
    ).toEqual([2]);
    expect(
      unbounded([
        'const presets = { strict: { timeout: 10 } };',
        "spawnSync('x', [], presets['strict']);",
      ]),
    ).toEqual([2]);
    expect(
      unbounded([
        'const presets = { strict: { timeout: 10 } };',
        "spawnSync('x', [], { ...presets.strict });",
      ]),
    ).toEqual([2]);
  });

  it('resolves frozen options and options held in a list', () => {
    expect(
      unbounded(['const o = Object.freeze({ timeout: 10 });', "spawnSync('x', [], o);"]),
    ).toEqual([2]);
    expect(
      unbounded(['const presets = [{ timeout: 10 }];', "spawnSync('x', [], presets[0]);"]),
    ).toEqual([2]);
    expect(
      unbounded([
        "const o = Object.freeze({ timeout: 10, killSignal: 'SIGKILL' });",
        "spawnSync('x', [], o);",
      ]),
    ).toEqual([]);
  });

  it('checks every options object a call could pass', () => {
    // Which branch runs is not knowable, so both are candidates and an
    // unbounded one is a violation. Returning a single object picked neither.
    expect(
      unbounded([
        'const lenient = { timeout: 10 };',
        "const strict = { timeout: 10, killSignal: 'SIGKILL' };",
        "spawnSync('x', [], flag ? lenient : strict);",
      ]),
    ).toEqual([3]);
    expect(
      unbounded([
        "const a = { timeout: 10, killSignal: 'SIGKILL' };",
        "const b = { timeout: 20, killSignal: 'SIGKILL' };",
        "spawnSync('x', [], flag ? a : b);",
      ]),
    ).toEqual([]);
  });

  it('follows the spawner through call and apply, and a parameter default', () => {
    expect(unbounded("spawnSync.call(null, 'x', [], { timeout: 10 });")).toEqual([1]);
    expect(unbounded("spawnSync.apply(null, ['x', [], { timeout: 10 }]);")).toEqual([1]);
    expect(
      unbounded("spawnSync.call(null, 'x', [], { timeout: 10, killSignal: 'SIGKILL' });"),
    ).toEqual([]);
    expect(unbounded("function run(o = { timeout: 10 }) { spawnSync('x', [], o); }")).toEqual([1]);
  });

  it('collects options written onto a name after it was created', () => {
    expect(unbounded(['const o = {};', 'o.timeout = 10;', "spawnSync('x', [], o);"])).toEqual([3]);
    expect(
      unbounded([
        'const o = {};',
        'o.timeout = 10;',
        "o.killSignal = 'SIGKILL';",
        "spawnSync('x', [], o);",
      ]),
    ).toEqual([]);
    // Either spelling of the write sets the same property.
    expect(unbounded(['const o = {};', "o['timeout'] = 10;", "spawnSync('x', [], o);"])).toEqual([
      3,
    ]);
    // A name with no literal to resolve at all — a parameter written to before
    // the call — is still read through its assignments.
    expect(unbounded("function run(o) { o.timeout = 10; spawnSync('x', [], o); }")).toEqual([1]);
    // Filtered by binding identity, not by spelling: a parameter named `o`
    // inside an unrelated function must not merge its signal into this object.
    expect(
      unbounded([
        'const o = {};',
        'o.timeout = 10;',
        "function configure(o) { o.killSignal = 'SIGKILL'; }",
        "spawnSync('x', [], o);",
      ]),
    ).toEqual([4]);
  });

  it('rejects an ignorable signal, not merely a missing property', () => {
    // SIGTERM is the default a child can trap — accepting any `killSignal`
    // accepts the exact failure the rule exists to prevent.
    expect(unbounded("spawnSync('a', [], { timeout: 10, killSignal: 'SIGTERM' });")).toEqual([1]);
  });
});
