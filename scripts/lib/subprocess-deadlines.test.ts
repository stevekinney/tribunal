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
/** The object literal a name is declared with in this file, if any. */
function declaredObjectLiteral(
  source: ts.SourceFile,
  name: string,
): ts.ObjectLiteralExpression | undefined {
  let found: ts.ObjectLiteralExpression | undefined;
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name &&
      node.initializer !== undefined &&
      ts.isObjectLiteralExpression(node.initializer)
    ) {
      found = node.initializer;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

export function unboundedSpawnCalls(source: string, fileName: string): number[] {
  const parsed = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const offenders: number[] = [];

  const propertyNamed = (options: ts.ObjectLiteralExpression, name: string) =>
    options.properties.find(
      (property) =>
        property.name !== undefined &&
        ts.isIdentifier(property.name) &&
        property.name.text === name,
    );

  // Local names bound to the `spawnSync` import, however it was spelled.
  const aliases = new Set<string>();
  const collectAliases = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      const named = node.importClause?.namedBindings;
      if (named !== undefined && ts.isNamedImports(named)) {
        for (const element of named.elements) {
          const imported = element.propertyName?.text ?? element.name.text;
          if (imported === 'spawnSync') aliases.add(element.name.text);
        }
      }
    }
    ts.forEachChild(node, collectAliases);
  };
  collectAliases(parsed);

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
        const argument = node.arguments[2];
        const options =
          argument !== undefined && ts.isObjectLiteralExpression(argument)
            ? argument
            : argument !== undefined && ts.isIdentifier(argument)
              ? declaredObjectLiteral(parsed, argument.text)
              : undefined;
        if (options !== undefined) {
          const deadline = propertyNamed(options, 'timeout');
          const signal = propertyNamed(options, 'killSignal');
          // The *value* matters, not the property. `killSignal: 'SIGTERM'` is
          // the default a child can trap, so accepting any signal accepts the
          // very thing the rule exists to prevent.
          const nonIgnorable =
            signal !== undefined &&
            ts.isPropertyAssignment(signal) &&
            ts.isStringLiteralLike(signal.initializer) &&
            signal.initializer.text === 'SIGKILL';
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

const spawners = tracked
  .filter((path) => readFileSync(join(root, path), 'utf8').includes('spawnSync'))
  .sort();

describe('every subprocess deadline is enforceable', () => {
  it('enumerates the spawners rather than trusting a list', () => {
    expect(spawners.length).toBeGreaterThan(0);
  });

  it.each(spawners)('%s bounds every deadline it sets', (relativePath) => {
    const source = readFileSync(join(root, relativePath), 'utf8');
    expect(unboundedSpawnCalls(source, relativePath)).toEqual([]);
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

  it('rejects an ignorable signal, not merely a missing property', () => {
    // SIGTERM is the default a child can trap — accepting any `killSignal`
    // accepts the exact failure the rule exists to prevent.
    expect(
      unboundedSpawnCalls("spawnSync('a', [], { timeout: 10, killSignal: 'SIGTERM' });\n", 'p.ts'),
    ).toEqual([1]);
  });
});
