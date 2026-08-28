import ts from 'typescript';

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
function constantSpecifier(node: ts.Node | undefined): string | undefined {
  if (node === undefined) return undefined;
  if (ts.isStringLiteralLike(node)) return node.text;
  return undefined;
}

/**
 * Returns every `bun:test` import in `contents`, in line order.
 *
 * `lineOffset` shifts reported line numbers, so a `<script>` block extracted
 * from a Svelte component reports lines in the coordinates of the original
 * file rather than of the extracted fragment.
 */
export function findBannedTestRunnerImports(contents: string, lineOffset = 0): BannedImport[] {
  const sourceFile = ts.createSourceFile(
    'scanned.ts',
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
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require';
      if (
        (isDynamicImport || isRequire) &&
        constantSpecifier(node.arguments[0]) === BANNED_SPECIFIER
      ) {
        record(node, isDynamicImport ? 'dynamic' : 'require');
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
  const found: BannedImport[] = [];
  const scriptBlock = /<script\b[^>]*>([\s\S]*?)<\/script>/g;

  for (const match of contents.matchAll(scriptBlock)) {
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
    : findBannedTestRunnerImports(contents);
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
