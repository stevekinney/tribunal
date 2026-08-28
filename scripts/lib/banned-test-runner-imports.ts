import ts from 'typescript';
import { parse as parseSvelte } from 'svelte/compiler';

/** The parts of Svelte's AST this module reads. */
type SvelteScript = { content: { start: number; end: number } };
type SvelteRoot = { instance?: SvelteScript | null; module?: SvelteScript | null };

/**
 * Detect `bun:test` imports in source text.
 *
 * Tribunal's test runner is vitest. A lint rule in `.oxlintrc.json` bans the
 * import, but a lint rule only reaches files something actually lints, and
 * `turbo run lint` only runs workspaces that declare a `lint` script — so
 * `runner/`, `.github/`, and any future workspace that omits the script are
 * silently exempt from it. This module backs the repository-wide check that
 * closes that gap (`scripts/validate-test-runner-imports.ts`).
 *
 * It also catches a form ESLint's own `no-restricted-imports` cannot see: that
 * rule matches static import and export declarations only, so a dynamic
 * `import(...)` reports nothing under plain ESLint. The limitation is ESLint's
 * specifically — oxlint 1.78 does flag the dynamic form — so the eleven
 * oxlint-backed workspaces are already covered there, and the gap this
 * backstop fills is the eslint-only `scripts/` workspace plus every unlinted
 * path.
 *
 * **This parses rather than pattern-matches, deliberately.** The previous
 * implementation was a set of regular expressions, and review found a new
 * lexical construct that defeated it in three consecutive rounds: multiline
 * imports, block comments between tokens, line comments between tokens,
 * template-literal specifiers, `import(spec, options)` with a second
 * argument, and a semicolon inside a comment inside a static import. Each fix
 * was correct and the next construct still slipped through, because a regular
 * expression cannot decide questions about a lexical grammar. TypeScript's
 * parser answers all of them by construction, and it is already a dependency.
 *
 * One deliberate behaviour changed with the rewrite, recorded rather than
 * dropped silently: the regex version reported import syntax appearing inside
 * a *comment*, and its own doc argued that was correct because a false
 * positive someone can rephrase beats a false negative nobody learns about.
 * That trade only existed because the matcher could not tell code from
 * commentary. A parser can, so there is no longer a false negative to trade
 * against, and a comment mentioning an import is no longer reported. The same
 * change removes the need for the allowlist the old check carried: this
 * module's own tests hold import syntax inside string literals, which a
 * parser correctly does not treat as imports, so **no file is excluded from
 * the scan at all.**
 */

/** A banned import found in one file. */
export type BannedImport = {
  /** 1-indexed line the import begins on. */
  line: number;
  /** The import's own source text, flattened to one line for the report. */
  text: string;
  /** Which import form matched, so the report can explain the rule's reach. */
  form: 'static' | 'dynamic' | 'require';
};

/**
 * The banned specifier, assembled at runtime rather than written as one
 * literal, so this module and its tests are not themselves reported. With a
 * parser this is belt-and-braces rather than load-bearing, but it costs
 * nothing and keeps the file readable next to its own subject.
 */
const BANNED_SPECIFIER = ['bun', 'test'].join(':');

/** Collapse a possibly-multiline node into one readable report line. */
function flatten(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * The literal value of a module specifier, or undefined when the specifier is
 * not a compile-time constant.
 *
 * Accepts a no-substitution template literal as well as a quoted string:
 * `import(`bun:test`)` is valid and loads the same module. A specifier built
 * at runtime (a variable, or a template with substitutions) is deliberately
 * not matched — its value is not knowable here, and guessing would produce
 * findings nobody can act on.
 */
/**
 * Strip the wrappers that change a node's shape without changing what it
 * means: grouping parentheses, and TypeScript's assertion forms, all of which
 * are erased before anything runs.
 *
 * One helper rather than a check at each call site, because the previous round
 * fixed parentheses on the *specifier* and left them unhandled on the
 * *callee*, and left assertions unhandled in both positions. Transparency is a
 * property of the node, not of where it happens to appear, so it is answered
 * once here and reused everywhere a node's identity matters.
 */
function unwrapTransparent(node: ts.Node): ts.Node {
  let current = node;
  for (;;) {
    if (ts.isParenthesizedExpression(current)) current = current.expression;
    // `x as const`, `<T>x`, `x satisfies T`, `x!` — all erased at compile time.
    else if (ts.isAsExpression(current)) current = current.expression;
    else if (ts.isTypeAssertionExpression(current)) current = current.expression;
    else if (ts.isSatisfiesExpression(current)) current = current.expression;
    else if (ts.isNonNullExpression(current)) current = current.expression;
    else return current;
  }
}

function constantSpecifier(node: ts.Node | undefined): string | undefined {
  if (node === undefined) return undefined;
  const current = unwrapTransparent(node);
  if (ts.isStringLiteralLike(current)) return current.text;
  return undefined;
}

/**
 * Returns every `bun:test` import in `contents`, in line order.
 *
 * `lineOffset` shifts reported line numbers, so a `<script>` block extracted
 * from a Svelte component reports lines in the coordinates of the original
 * file rather than of the extracted fragment.
 */
export function findBannedTestRunnerImports(
  contents: string,
  lineOffset = 0,
  fileName = 'scanned.ts',
): BannedImport[] {
  // The file name is what selects the grammar. Parsing a `.tsx` or `.jsx`
  // file as `.ts` mis-parses every JSX element, and the malformed subtree
  // contains no call expression — so an import nested inside JSX simply is
  // not there to find. Passing the real name makes TypeScript choose the
  // matching `ScriptKind` itself.
  const sourceFile = ts.createSourceFile(
    fileName,
    contents,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
  );

  const found: BannedImport[] = [];

  const record = (node: ts.Node, form: BannedImport['form']): void => {
    const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    found.push({ line: line + 1 + lineOffset, text: flatten(node.getText(sourceFile)), form });
  };

  const visit = (node: ts.Node): void => {
    // `import ... from '...'` and `import '...'`, including `import type`.
    if (ts.isImportDeclaration(node)) {
      if (constantSpecifier(node.moduleSpecifier) === BANNED_SPECIFIER) record(node, 'static');
    }
    // `export ... from '...'`.
    else if (ts.isExportDeclaration(node)) {
      if (constantSpecifier(node.moduleSpecifier) === BANNED_SPECIFIER) record(node, 'static');
    }
    // `import('...')`, with or without a second options argument, and
    // `require('...')`.
    else if (ts.isCallExpression(node)) {
      // `(require)('bun:test')` and `(module.require)('bun:test')` call the
      // same loaders; grouping around the callee is as transparent as grouping
      // around the argument.
      const callee = unwrapTransparent(node.expression);
      const isDynamicImport = callee.kind === ts.SyntaxKind.ImportKeyword;
      // The three receivers that are actually module loaders: a bare
      // `require(...)`, CommonJS's `module.require(...)`, and Bun's
      // `import.meta.require(...)`.
      //
      // Deliberately NOT any `<anything>.require(...)`: an arbitrary object
      // with a `require` method is not a module system, and a test below pins
      // that `options.require('...')` and `config.require('...')` stay
      // unreported.
      const isRequire =
        (ts.isIdentifier(callee) && callee.text === 'require') ||
        (ts.isPropertyAccessExpression(callee) &&
          callee.name.text === 'require' &&
          ((ts.isIdentifier(unwrapTransparent(callee.expression)) &&
            (unwrapTransparent(callee.expression) as ts.Identifier).text === 'module') ||
            // `import.meta` specifically. `ts.isMetaProperty` alone is also
            // true for `new.target`, and `new.target.require(...)` is a method
            // on an arbitrary object, which the surrounding predicate
            // deliberately does not treat as a loader.
            (ts.isMetaProperty(unwrapTransparent(callee.expression)) &&
              (unwrapTransparent(callee.expression) as ts.MetaProperty).keywordToken ===
                ts.SyntaxKind.ImportKeyword &&
              (unwrapTransparent(callee.expression) as ts.MetaProperty).name.text === 'meta')));
      if (
        (isDynamicImport || isRequire) &&
        constantSpecifier(node.arguments[0]) === BANNED_SPECIFIER
      ) {
        record(node, isDynamicImport ? 'dynamic' : 'require');
      }
    }
    // `type T = import('...').X`, TypeScript's import-type expression. It is
    // neither a declaration nor a call, so nothing above sees it — and the
    // equivalent `import type { X } from '...'` is already banned, so missing
    // this would leave an inconsistent rule.
    else if (ts.isImportTypeNode(node)) {
      const argument = node.argument;
      if (
        ts.isLiteralTypeNode(argument) &&
        constantSpecifier(argument.literal) === BANNED_SPECIFIER
      ) {
        record(node, 'static');
      }
    }
    // `import x = require('...')`, the TypeScript-only form.
    else if (ts.isImportEqualsDeclaration(node)) {
      const reference = node.moduleReference;
      if (
        ts.isExternalModuleReference(reference) &&
        constantSpecifier(reference.expression) === BANNED_SPECIFIER
      ) {
        record(node, 'require');
      }
    }

    ts.forEachChild(node, visit);
  };

  ts.forEachChild(sourceFile, visit);

  return found.sort((first, second) => first.line - second.line);
}

/**
 * Svelte components are not TypeScript, so the parser cannot read one whole.
 * Their `<script>` blocks are, and that is the only place a component can
 * import anything.
 */
export function findBannedImportsInSvelte(contents: string): BannedImport[] {
  // Svelte's own parser, not a hand-rolled scan.
  //
  // Three consecutive review rounds found a lexical context the hand-rolled
  // version got wrong: comment delimiters as string data inside a script,
  // then the same delimiters inside a Svelte expression (`{'<!--'}`) in
  // markup. Attribute strings would have been next. Deciding which `<!--` is
  // a comment and which `<script>` is real requires knowing Svelte's grammar,
  // and re-deriving that grammar incrementally from review feedback is the
  // same mistake this module already made once with regular expressions.
  //
  // `svelte` is already a dependency of this repository at the same version
  // `applications/web` pins.
  let root: SvelteRoot;
  try {
    root = parseSvelte(contents, { modern: true }) as SvelteRoot;
  } catch {
    // Never return "clean" here.
    //
    // The previous version did, on the reasoning that a component which does
    // not parse fails Svelte's own build. That reasoning was wrong:
    // `applications/web/svelte.config.js` enables `vitePreprocess()`, so a
    // component can legitimately require preprocessing before Svelte's parser
    // accepts it while still building perfectly well. Silently reporting
    // nothing for such a file is a false negative in a ban.
    //
    // Falling back to extracting `<script>` blocks textually is less precise
    // than the real parser — a commented-out block would be reported — but it
    // fails closed, and a false positive on a component the parser could not
    // read is much cheaper than missing a real import in one.
    return findBannedImportsInUnparseableSvelte(contents);
  }

  const found: BannedImport[] = [];

  for (const script of [root.instance, root.module]) {
    if (!script) continue;
    const { start, end } = script.content;
    const lineOffset = contents.slice(0, start).split('\n').length - 1;
    found.push(...findBannedTestRunnerImports(contents.slice(start, end), lineOffset));
  }

  return found.sort((first, second) => first.line - second.line);
}

/**
 * Last-resort reader for a component Svelte's own parser rejected. Extracts
 * `<script>` blocks textually and parses each as TypeScript, so an import is
 * still found rather than silently missed.
 */
function findBannedImportsInUnparseableSvelte(contents: string): BannedImport[] {
  const found: BannedImport[] = [];
  for (const match of contents.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) {
    const body = match[1];
    if (body === undefined) continue;
    const bodyStart = (match.index ?? 0) + match[0].indexOf(body);
    const lineOffset = contents.slice(0, bodyStart).split('\n').length - 1;
    found.push(...findBannedTestRunnerImports(body, lineOffset));
  }
  return found.sort((first, second) => first.line - second.line);
}

/** Dispatch to the right reader for a path's extension. */
export function findBannedImportsForPath(path: string, contents: string): BannedImport[] {
  return path.endsWith('.svelte')
    ? findBannedImportsInSvelte(contents)
    : findBannedTestRunnerImports(contents, 0, path);
}

/** File extensions whose contents can contain a module import. */
export const SCANNABLE_EXTENSIONS: readonly string[] = [
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.svelte',
];

/** Whether a filename has an extension whose contents can hold an import. */
export function isScannableFile(fileName: string): boolean {
  return SCANNABLE_EXTENSIONS.some((extension) => fileName.endsWith(extension));
}

/**
 * Whether an extensionless file is a script Bun or Node would execute.
 *
 * A conventional entrypoint like `bin/run-tests` carries no extension and is
 * identified by its shebang instead. An extension-only predicate skips it
 * before parsing, so such a file could import the banned runner while both
 * pre-commit and CI reported success.
 *
 * Only the first line is inspected, and only when the name has no extension at
 * all — this must not start reading every `LICENSE` and `Makefile` in the
 * repository as source.
 */
export function hasScriptShebang(firstLine: string): boolean {
  return /^#!.*\b(bun|node|deno|tsx)\b/.test(firstLine);
}

/** Whether a path has no extension, so its shebang decides. */
export function isExtensionlessPath(path: string): boolean {
  const base = path.slice(path.lastIndexOf('/') + 1);
  return base.length > 0 && !base.includes('.');
}
