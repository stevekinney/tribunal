import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync } from 'node:fs';
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

/**
 * The synchronous spawners this invariant covers.
 *
 * `AGENTS.md` requires orchestration scripts to "enforce explicit subprocess
 * timeouts and terminate hung child processes" — subprocesses, not
 * `spawnSync` specifically. Checking only the one name was a scope hole in a
 * documented rule, and it was hiding a live defect: `runner/run-agent.mjs`
 * read git objects through an unbounded `execFileSync` during a review run.
 *
 * All three take the same `timeout`/`killSignal` pair with the same defect —
 * `timeout` alone signals and then *waits* — and all three put options either
 * last or second, which the reader already handles without knowing which is
 * which.
 */
const SYNC_SPAWNERS = new Set(['spawnSync', 'execFileSync', 'execSync']);

/** Whether a call loads `node:child_process`, by either loader spelling. */
function loadsChildProcess(candidate: ts.Node): boolean {
  // `const cp = await import('node:child_process')` is the ordinary ESM form,
  // and the awaited value is what the name holds.
  const node = unwrapTransparent(candidate);
  if (!ts.isCallExpression(node)) return false;
  const dynamic = node.expression.kind === ts.SyntaxKind.ImportKeyword;
  // `const load = require; load('node:child_process')` reaches the same loader,
  // so the callee is asked the same question the import matcher asks rather
  // than compared against a spelling.
  const callee = unwrapTransparent(node.expression);
  const required =
    ts.isIdentifier(callee) &&
    callee.text === 'require' &&
    innermostBinding(callee, callee.text, true) === undefined;
  const aliased =
    ts.isIdentifier(callee) &&
    aliasInitializers(callee).some((initializer) => {
      const source = unwrapTransparent(initializer);
      return (
        ts.isIdentifier(source) &&
        source.text === 'require' &&
        innermostBinding(source, source.text, true) === undefined
      );
    });
  if (!dynamic && !required && !aliased) return false;
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
    if (NODE_CHILD_PROCESS.has(specifier.text)) return SYNC_SPAWNERS.has(imported);
    return specifier.text.startsWith('.') ? exportsOf(specifier.text).has(imported) : false;
  };

  // One reader per declaration kind. This began as a single walker and grew a
  // branch per review finding — named import, namespace import, default
  // import, `require` destructuring, `require` namespace, identifier alias,
  // member alias, named re-export, star re-export, exported const — until the
  // complexity gate rejected it. That gate was right: the shape of the code
  // had stopped matching the shape of the question.
  const readImport = (node: ts.ImportDeclaration): void => {
    const clause = node.importClause?.namedBindings;
    if (clause !== undefined && ts.isNamedImports(clause)) {
      for (const element of clause.elements) {
        const imported = element.propertyName?.text ?? element.name.text;
        if (fromSpecifier(node.moduleSpecifier, imported) === true) {
          direct.set(element.name.text, element.name);
        }
      }
    }
    // `import * as cp from 'node:child_process'` binds the module object, and
    // `cp.spawnSync(...)` is the same call written through it. So does Node's
    // default import, which has no `namedBindings` at all — reading only those
    // left the file with no spawner binding and dropped it from the scan.
    if (
      !ts.isStringLiteralLike(node.moduleSpecifier) ||
      !NODE_CHILD_PROCESS.has(node.moduleSpecifier.text)
    ) {
      return;
    }
    if (clause !== undefined && ts.isNamespaceImport(clause)) {
      namespaces.set(clause.name.text, clause.name);
    }
    if (node.importClause?.name !== undefined) {
      namespaces.set(node.importClause.name.text, node.importClause.name);
    }
  };

  /** The property a member read names, in either spelling. */
  const memberRead = (node: ts.Expression): string | undefined => {
    if (!ts.isPropertyAccessExpression(node) && !ts.isElementAccessExpression(node))
      return undefined;
    if (!ts.isIdentifier(node.expression) || !namespaces.has(node.expression.text))
      return undefined;
    return ts.isPropertyAccessExpression(node)
      ? node.name.text
      : ts.isStringLiteralLike(node.argumentExpression)
        ? node.argumentExpression.text
        : undefined;
  };

  const readDeclaration = (node: ts.VariableDeclaration): void => {
    const initializer = node.initializer;
    if (initializer === undefined) return;

    // The CommonJS spellings: `const { spawnSync } = require('node:child_process')`
    // binds the name, and `const cp = require('node:child_process')` binds the
    // module object. Dropping these while tightening provenance would have
    // traded a false positive for a false negative.
    if (loadsChildProcess(initializer)) {
      if (ts.isIdentifier(node.name)) namespaces.set(node.name.text, node.name);
      if (ts.isObjectBindingPattern(node.name)) {
        for (const element of node.name.elements) {
          // `const { 'spawnSync': run } = require('node:child_process')` is
          // legal and names the same export; an identifier-only read recorded
          // no binding, so the call was never inspected.
          const key =
            element.propertyName !== undefined
              ? staticPropertyName(element.propertyName)
              : ts.isIdentifier(element.name)
                ? element.name.text
                : undefined;
          if (key !== undefined && SYNC_SPAWNERS.has(key) && ts.isIdentifier(element.name)) {
            direct.set(element.name.text, element.name);
          }
        }
      }
    }

    // `const run = spawnSync` aliases a name already known to be one, and
    // `const run = childProcess.spawnSync` aliases the same function off the
    // module object.
    if (!ts.isIdentifier(node.name)) return;
    const aliases =
      (ts.isIdentifier(initializer) && direct.has(initializer.text)) ||
      SYNC_SPAWNERS.has(memberRead(initializer) ?? '');
    if (aliases) direct.set(node.name.text, node.name);
  };

  const readExport = (node: ts.ExportDeclaration): void => {
    if (node.exportClause !== undefined && ts.isNamedExports(node.exportClause)) {
      for (const element of node.exportClause.elements) {
        const from = element.propertyName?.text ?? element.name.text;
        const viaModule = fromSpecifier(node.moduleSpecifier, from);
        if (viaModule === true || (viaModule === undefined && direct.has(from))) {
          exported.add(element.name.text);
        }
      }
      return;
    }
    // `export * from './spawner'` re-exports every alias that module exports.
    if (
      node.exportClause === undefined &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteralLike(node.moduleSpecifier) &&
      node.moduleSpecifier.text.startsWith('.')
    ) {
      for (const name of exportsOf(node.moduleSpecifier.text)) exported.add(name);
    }
  };

  const readExportedConst = (node: ts.VariableStatement): void => {
    const shared =
      node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) === true;
    if (!shared) return;
    for (const declaration of node.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && direct.has(declaration.name.text)) {
        exported.add(declaration.name.text);
      }
    }
  };

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) readImport(node);
    if (ts.isVariableDeclaration(node)) readDeclaration(node);
    if (ts.isExportDeclaration(node)) readExport(node);
    if (ts.isVariableStatement(node)) readExportedConst(node);
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
      //
      // A value that *is* readable has to bound something. `timeout: 0` states
      // a deadline and imposes none — a Node 24 child with it runs to normal
      // completion — so certifying the call because the property exists
      // approves a subprocess that can still hang. A positive finite literal
      // is a deadline; zero, a negative, or anything unreadable is not one this
      // guard can certify, and unreadable means report.
      if (!ts.isPropertyAssignment(property)) {
        deadline = true;
        continue;
      }
      const value = unwrapTransparent(property.initializer);
      // A type guard as much as a check: `.text` exists only on a literal. Its
      // runtime effect overlaps the finite test below — a non-literal would
      // yield `NaN` there and report anyway — so the two together say the same
      // thing twice, and only the message differs.
      if (!ts.isNumericLiteral(value)) {
        return { kind: 'unreadable', because: 'a timeout that is not written as a number' };
      }
      const milliseconds = Number(value.text);
      if (!Number.isFinite(milliseconds) || milliseconds <= 0) {
        return { kind: 'unbounded', because: 'a timeout that imposes no deadline' };
      }
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

/**
 * Every spawn call in a source, and which of them are unbounded.
 *
 * Both answers come from one walk because they are one question asked twice:
 * "does this file contain a spawner call" and "is that call bounded" were
 * previously answered by separate code, and the file-selection copy used a text
 * prefilter that a bracketed member read walked straight past.
 */
export function inspectSpawnCalls(
  source: string,
  fileName: string,
  index: ReadonlyMap<string, Set<string>> = new Map(),
  tracked: ReadonlySet<string> = new Set(index.keys()),
): { calls: number[]; unbounded: number[] } {
  const parsed = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const calls: number[] = [];
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
    // Both spellings of a member read call the same function, so recognising
    // only the dotted one is bypassed by writing `Bun['spawnSync']`.
    const member = ts.isPropertyAccessExpression(callee)
      ? { receiver: callee.expression, name: callee.name.text }
      : ts.isElementAccessExpression(callee) && ts.isStringLiteralLike(callee.argumentExpression)
        ? { receiver: callee.expression, name: callee.argumentExpression.text }
        : undefined;
    if (member === undefined) return false;
    if (!SYNC_SPAWNERS.has(member.name)) return false;
    // `require('node:child_process').spawnSync(...)` needs no name at all: the
    // receiver is the loader call itself, which the identifier-only check
    // rejected before the options were ever read.
    if (loadsChildProcess(member.receiver)) return true;
    if (!ts.isIdentifier(member.receiver)) return false;
    const receiver = member.receiver;
    // `function run(Bun) { Bun.spawnSync(…) }` is an arbitrary object's method,
    // not the global — so the global is recognised only where nothing binds the
    // name, which is the same binding question every other receiver goes
    // through rather than a shortcut beside it.
    // Bun's namespace carries `spawnSync` only; the exec family is Node's.
    if (receiver.text === 'Bun') {
      return (
        member.name === 'spawnSync' && innermostBinding(receiver, receiver.text, true) === undefined
      );
    }
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
      // Both spellings of the forwarder name the same function, so accepting
      // only the dotted one is bypassed by writing `spawnSync['call']`.
      const forwarderName = ts.isPropertyAccessExpression(callee)
        ? callee.name.text
        : ts.isElementAccessExpression(callee) && ts.isStringLiteralLike(callee.argumentExpression)
          ? callee.argumentExpression.text
          : undefined;
      const forwarder =
        (forwarderName === 'call' || forwarderName === 'apply') &&
        (ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee))
          ? { receiver: callee.expression, name: forwarderName }
          : undefined;
      // `spawnSync!(…)` and `(0, spawnSync)(…)` are the same call wearing a
      // wrapper this module already knows how to remove.
      const target = unwrapTransparent(forwarder === undefined ? callee : forwarder.receiver);

      if (isSpawner(target)) {
        calls.push(parsed.getLineAndCharacterOfPosition(node.getStart()).line + 1);
        const forwarded =
          forwarder === undefined
            ? [...node.arguments]
            : forwarder.name === 'call'
              ? node.arguments.slice(1)
              : (() => {
                  const list = node.arguments[1];
                  return list !== undefined && ts.isArrayLiteralExpression(list)
                    ? [...list.elements]
                    : undefined;
                })();

        // An `.apply` list this guard cannot read is not "no arguments" — it is
        // arguments it cannot see, which under a fail-closed contract must
        // report. Treating it as empty made `spawnSync.apply(null, invocation)`
        // pass, a hole in the very property the rewrite was for.
        if (forwarded === undefined) {
          offenders.push(parsed.getLineAndCharacterOfPosition(node.getStart()).line + 1);
          ts.forEachChild(node, visit);
          return;
        }

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
          (ts.isPropertyAccessExpression(target) || ts.isElementAccessExpression(target)) &&
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
  return { calls, unbounded: offenders };
}

/** The lines of every spawn call that sets a deadline this guard cannot certify. */
export function unboundedSpawnCalls(
  source: string,
  fileName: string,
  index: ReadonlyMap<string, Set<string>> = new Map(),
  tracked: ReadonlySet<string> = new Set(index.keys()),
): number[] {
  return inspectSpawnCalls(source, fileName, index, tracked).unbounded;
}

const READABLE_MODES = new Set(['100644', '100755']);
/**
 * The guard's own subprocesses, bounded — which they were not.
 *
 * These run during module initialisation, before Vitest's per-test timeout
 * exists, so a stalled git or filesystem hung `bun run verify` with nothing to
 * interrupt it. A guard that enforces subprocess deadlines while setting none
 * of its own is not a subtle inconsistency; it is the invariant failing on its
 * author. `timeout` alone signals and then waits, so the non-ignorable signal
 * is what makes it a deadline — the same pairing this file exists to require,
 * and the same one `validate-test-runner-imports.ts` already uses.
 */
const git = (...args: string[]): string[] =>
  execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    // Written at the call rather than behind a name, because that is what
    // this guard requires of every other deadline: a value it can read.
    timeout: 30_000,
    killSignal: 'SIGKILL',
  })
    .split('\0')
    .filter((entry) => entry.length > 0);

// Tracked entries come with modes, so symlinks and gitlinks are filtered by
// what git says they are rather than guessed from the path: this repository
// tracks `.claude/skills/tensorlake` as a symlink to a directory, and reading
// it throws EISDIR.
const trackedSources = git('ls-files', '-z', '--stage').flatMap((entry) => {
  const separator = entry.indexOf('\t');
  if (separator < 0) return [];
  return READABLE_MODES.has(entry.slice(0, entry.indexOf(' '))) ? [entry.slice(separator + 1)] : [];
});

// Untracked-but-not-ignored files are inspected too, which is what the sibling
// scanner already does. A guard that reads only the index reports success for a
// worktree where a new orchestration script sets an unbounded deadline, right
// up until someone stages it — and `bun run verify` is run *before* staging.
// `--others` carries no mode, so the filesystem answers instead.
const untrackedSources = git('ls-files', '-z', '--others', '--exclude-standard').filter((path) => {
  try {
    return lstatSync(join(root, path)).isFile();
  } catch {
    return false;
  }
});

const tracked = [...trackedSources, ...untrackedSources];

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

// A tracked path can be absent from the worktree: `git ls-files` still lists a
// file the developer has deleted but not yet staged, and an unconditional read
// threw `ENOENT` during module initialisation — aborting the scripts suite, the
// coverage run, and `bun run verify` before a single source was checked. A
// guard that cannot run is worse than one that misses something.
const readSource = (path: string): string | undefined => {
  try {
    return readFileSync(join(root, path), 'utf8');
  } catch {
    return undefined;
  }
};

const sources = new Map(
  tracked
    .flatMap((path) => {
      const text = readSource(path);
      return text === undefined ? [] : [[path, text] as const];
    })
    .filter(([path, text]) => isInspectableSource(path, text)),
);

const repositoryAliases = exportedSpawnAliases(sources);
const trackedPaths = new Set(sources.keys());

// Every source is inspected. Selecting files by whether their text mentions the
// spawner was itself a hole — a module can re-export it under another name, and
// its caller then mentions it nowhere.
// Which files hold a spawn call is answered by the same walk that judges them,
// rather than by a second detector. The previous one asked whether the text
// contained `Bun.spawnSync`, which `Bun['spawnSync']` does not — a text
// prefilter in front of an AST guard, which is the shape of hole this pair has
// been corrected for twice already.
const spawners = [...sources]
  .filter(
    ([path, text]) =>
      inspectSpawnCalls(text, path, repositoryAliases, trackedPaths).calls.length > 0,
  )
  .map(([path]) => path)
  .sort();

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

  it('requires a timeout value that actually bounds something', () => {
    // `timeout: 0` states a deadline and imposes none — a Node 24 child with
    // it runs to normal completion — so certifying the call because the
    // property exists approves a subprocess that can still hang.
    expect(unbounded("spawnSync('x', [], { timeout: 0, killSignal: 'SIGKILL' });")).toEqual([1]);
    expect(unbounded("spawnSync('x', [], { timeout: -1, killSignal: 'SIGKILL' });")).toEqual([1]);
    // A value the guard cannot read is not one it can certify. The remedy is
    // the contract's remedy everywhere: write it at the call.
    expect(
      unbounded([
        'const ms = 30_000;',
        "spawnSync('x', [], { timeout: ms, killSignal: 'SIGKILL' });",
      ]),
    ).toEqual([2]);
    expect(unbounded("spawnSync('x', [], { timeout: 30_000, killSignal: 'SIGKILL' });")).toEqual(
      [],
    );
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

  it('binds the module object through a default import as well as a namespace one', () => {
    // Node supports `import childProcess from 'node:child_process'`, which has
    // no `namedBindings` at all — reading only those left the file with no
    // spawner binding, so it was dropped from the scan entirely.
    expect(
      unboundedSpawnCalls(
        "import childProcess from 'node:child_process';\nchildProcess.spawnSync('x', [], { timeout: 10 });\n",
        'p.ts',
      ),
    ).toEqual([2]);
  });

  it('covers the whole synchronous spawner family, not one name', () => {
    // `AGENTS.md` requires orchestration scripts to enforce subprocess
    // timeouts — subprocesses, not `spawnSync` specifically. Checking one name
    // was a scope hole in a documented rule, and `execFileSync`/`execSync`
    // carry the same `timeout`-without-`killSignal` defect.
    for (const spawner of ['spawnSync', 'execFileSync', 'execSync']) {
      const unbounded = [
        `import { ${spawner} } from 'node:child_process';`,
        `${spawner}('x', [], { timeout: 10 });`,
      ].join('\n');
      expect(unboundedSpawnCalls(unbounded, 'p.ts'), spawner).toEqual([2]);

      const bounded = [
        `import { ${spawner} } from 'node:child_process';`,
        `${spawner}('x', [], { timeout: 10, killSignal: 'SIGKILL' });`,
      ].join('\n');
      expect(unboundedSpawnCalls(bounded, 'p.ts'), spawner).toEqual([]);
    }
    // Bun's namespace carries `spawnSync` only; the exec family is Node's.
    expect(unboundedSpawnCalls("Bun.execSync('x', { timeout: 10 });\n", 'p.ts')).toEqual([]);
  });

  it('unwraps a transparent wrapper on the callee before asking provenance', () => {
    expect(unbounded("spawnSync!('x', [], { timeout: 10 });")).toEqual([1]);
    expect(unbounded("(0, spawnSync)('x', [], { timeout: 10 });")).toEqual([1]);
  });

  it('folds a quoted key when destructuring the spawner', () => {
    // `const { 'spawnSync': run } = require('node:child_process')` names the
    // same export; an identifier-only read recorded no binding at all, so the
    // call was never inspected.
    expect(
      unboundedSpawnCalls(
        "const { 'spawnSync': run } = require('node:child_process');\nrun('x', [], { timeout: 10 });\n",
        'p.ts',
      ),
    ).toEqual([2]);
  });

  it('recognises an awaited or aliased child_process load', () => {
    // `const cp = await import('node:child_process')` is the ordinary ESM
    // form, and `const load = require; load('node:child_process')` reaches the
    // same loader — the callee is asked the question rather than compared
    // against a spelling.
    expect(
      unboundedSpawnCalls(
        "const cp = await import('node:child_process');\ncp.spawnSync('x', [], { timeout: 10 });\n",
        'p.ts',
      ),
    ).toEqual([2]);
    expect(
      unboundedSpawnCalls(
        "const load = require;\nconst { spawnSync } = load('node:child_process');\nspawnSync('x', [], { timeout: 10 });\n",
        'p.ts',
      ),
    ).toEqual([3]);
  });

  it('recognises a loader call used directly as the receiver', () => {
    // `require('node:child_process').spawnSync(…)` needs no name at all, and
    // the identifier-only receiver check rejected it before the options were
    // read.
    expect(
      unboundedSpawnCalls(
        "require('node:child_process').spawnSync('x', [], { timeout: 10 });\n",
        'p.ts',
      ),
    ).toEqual([1]);
    expect(
      unboundedSpawnCalls(
        "require('node:child_process').spawnSync('x', [], { timeout: 10, killSignal: 'SIGKILL' });\n",
        'p.ts',
      ),
    ).toEqual([]);
  });

  it('treats Bun as the global only where nothing binds the name', () => {
    // `function run(Bun) { … }` is an arbitrary object's method, and reporting
    // it fails the repository over ordinary application code. The receiver goes
    // through the same binding question every other one does.
    expect(
      unboundedSpawnCalls("function run(Bun) { Bun.spawnSync('x', { timeout: 10 }); }\n", 'p.ts'),
    ).toEqual([]);
    expect(unboundedSpawnCalls("Bun.spawnSync('x', { timeout: 10 });\n", 'p.ts')).toEqual([1]);
  });

  it('follows an alias taken off the module object', () => {
    // `const run = childProcess.spawnSync` aliases the same function the
    // namespace exposes; reading only the identifier form left the route
    // uncounted, so its calls were never inspected at all.
    expect(
      unboundedSpawnCalls(
        "import * as cp from 'node:child_process';\nconst run = cp.spawnSync;\nrun('x', [], { timeout: 10 });\n",
        'p.ts',
      ),
    ).toEqual([3]);
  });

  it('recognises a bracketed call or apply forwarder', () => {
    expect(unbounded("spawnSync['call'](null, 'x', [], { timeout: 10 });")).toEqual([1]);
    expect(
      unbounded("spawnSync['call'](null, 'x', [], { timeout: 10, killSignal: 'SIGKILL' });"),
    ).toEqual([]);
    expect(unbounded("spawnSync['apply'](null, ['x', [], { timeout: 10 }]);")).toEqual([1]);
  });

  it('recognises a spawner written with a bracketed member read', () => {
    // Both spellings call the same function, and the file-selection pass used
    // to ask whether the text contained `Bun.spawnSync` — a text prefilter in
    // front of an AST guard, which this one walked straight past.
    expect(unboundedSpawnCalls("Bun['spawnSync'](cmd, { timeout: 10 });\n", 'p.ts')).toEqual([1]);
    expect(
      unboundedSpawnCalls(
        "Bun['spawnSync'](cmd, { timeout: 10, killSignal: 'SIGKILL' });\n",
        'p.ts',
      ),
    ).toEqual([]);
    expect(inspectSpawnCalls("Bun['spawnSync'](cmd, {});\n", 'p.ts').calls).toEqual([1]);
  });

  it('reports an apply list it cannot read, rather than reading it as no arguments', () => {
    // A hole in the fail-closed contract itself: an unreadable list is not
    // "no arguments", it is arguments the guard cannot see.
    expect(
      unbounded([
        "const invocation = ['x', [], { timeout: 10 }];",
        'spawnSync.apply(null, invocation);',
      ]),
    ).toEqual([2]);
    expect(
      unbounded("spawnSync.apply(null, ['x', [], { timeout: 10, killSignal: 'SIGKILL' }]);"),
    ).toEqual([]);
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
