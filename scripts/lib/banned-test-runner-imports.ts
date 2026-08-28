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
    // `(0, require)(...)` is the conventional indirect-call spelling; a comma
    // expression evaluates to its final operand, so that operand is the real
    // callee.
    else if (
      ts.isBinaryExpression(current) &&
      current.operatorToken.kind === ts.SyntaxKind.CommaToken
    )
      current = current.right;
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

  // `import('bun:' + 'test')` names the same module as `import('bun:test')`.
  // Only `+` over operands that are themselves constant is folded — anything
  // involving a variable is not knowable here, and guessing would produce
  // findings nobody can act on.
  if (ts.isBinaryExpression(current) && current.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = constantSpecifier(current.left);
    const right = constantSpecifier(current.right);
    if (left !== undefined && right !== undefined) return left + right;
  }

  return undefined;
}

/**
 * The property name a member access reads, when it is statically known.
 *
 * Covers both spellings: `module.require` is a `PropertyAccessExpression`,
 * `module['require']` is an `ElementAccessExpression` with a literal
 * argument. They call the same function, so a predicate that recognises only
 * the first is bypassed by writing the second.
 */
function staticMemberName(node: ts.Node): { object: ts.Node; name: string } | undefined {
  if (ts.isPropertyAccessExpression(node)) {
    return { object: unwrapTransparent(node.expression), name: node.name.text };
  }
  if (ts.isElementAccessExpression(node)) {
    // Folded the same way a specifier is: the validator already evaluates
    // `'bun:' + 'test'`, and applying a different standard to the member name
    // would be an inconsistency rather than a decision.
    const name = constantSpecifier(node.argumentExpression);
    if (name !== undefined) {
      return { object: unwrapTransparent(node.expression), name };
    }
  }
  return undefined;
}

/**
 * A function's block body, when it has one.
 *
 * `ts.isFunctionLike` narrows to `SignatureDeclaration`, which does not
 * declare `body` even though every function-like node that has a body is
 * assignable to it — so the cast is localized here with the reason rather
 * than repeated at each use.
 */
function functionBodyOf(node: ts.Node): ts.Block | undefined {
  if (!ts.isFunctionLike(node)) return undefined;
  const body = (node as ts.FunctionLikeDeclaration).body;
  return body !== undefined && ts.isBlock(body) ? body : undefined;
}

/**
 * Whether an identifier is bound by the source itself rather than by the
 * runtime.
 *
 * A file that declares `function require(...)` or takes a `module` parameter
 * is calling its own code, not a module loader, and reporting it would reject
 * a valid commit. Resolved by walking the node's ancestors — which is why the
 * source file is parsed with `setParentNodes` — so a shadow in one function
 * does not excuse a genuine loader call elsewhere in the same file. That
 * file-wide approximation would have been the easy version and would trade
 * this false positive for a false negative.
 */
function isLocallyShadowed(node: ts.Node, name: string): boolean {
  /** A binding introduced by this node, if it names `name`. */
  /**
   * Whether a binding name introduces `name`, following destructuring.
   *
   * `function load({ require })` binds `require` just as surely as
   * `function load(require)` does, but its `name` is an `ObjectBindingPattern`
   * rather than an identifier — so an identifier-only check reported a call
   * that invokes the caller's own function.
   */
  const nameBinds = (node: ts.Node | undefined): boolean => {
    if (node === undefined) return false;
    if (ts.isObjectBindingPattern(node) || ts.isArrayBindingPattern(node)) {
      // An `OmittedExpression` (the hole in `[, x]`) is not a binding element,
      // so `some` correctly skips it.
      return node.elements.some(
        (element) => ts.isBindingElement(element) && nameBinds(element.name),
      );
    }
    // Every remaining binding name is an identifier; anything else is not a
    // binding of this name. Written as one return rather than an identifier
    // check plus a trailing `return false`, which was unreachable — no AST
    // node reaches it, and the coverage gate said so.
    return ts.isIdentifier(node) && node.text === name;
  };

  /**
   * `declare const require: ...` is a type-only assertion that some runtime
   * binding exists. TypeScript erases it, so it introduces nothing and cannot
   * shadow the real loader — treating it as a binding suppressed a genuine
   * finding.
   */
  const isAmbient = (candidate: ts.Node): boolean =>
    (ts.getCombinedModifierFlags(candidate as ts.Declaration) & ts.ModifierFlags.Ambient) !== 0;

  const bindsName = (candidate: ts.Node): boolean =>
    !isAmbient(candidate) &&
    (ts.isVariableDeclaration(candidate) ||
      ts.isFunctionDeclaration(candidate) ||
      ts.isParameter(candidate) ||
      ts.isClassDeclaration(candidate) ||
      ts.isImportSpecifier(candidate) ||
      ts.isImportClause(candidate) ||
      ts.isBindingElement(candidate)) &&
    nameBinds(candidate.name);

  /**
   * Declarations written directly in this scope's own statement list.
   *
   * Deliberately does not descend into a nested block: `let`, `const`, and
   * `class` are block-scoped, so `{ const require = x; }` binds nothing
   * outside its braces. Treating it as a shadow let a genuine loader call
   * after such a block go unreported — a false negative introduced by the
   * previous round's fix for the opposite problem.
   */
  const declaredDirectlyIn = (scope: ts.Node): boolean => {
    let found = false;
    const statements = ts.isSourceFile(scope)
      ? scope.statements
      : ts.isBlock(scope)
        ? scope.statements
        : functionBodyOf(scope)?.statements;

    if (ts.isFunctionLike(scope)) {
      for (const parameter of scope.parameters) if (bindsName(parameter)) found = true;
    }
    for (const statement of statements ?? []) {
      if (bindsName(statement)) found = true;
      if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          if (bindsName(declaration)) found = true;
        }
      }
    }
    return found;
  };

  /**
   * `var` is function-scoped, so one written inside a nested block still binds
   * across the whole function. Searched separately, and **only** for `var`.
   *
   * Function declarations deliberately excluded: in a module (and anywhere
   * strict), a function declared inside a block is block-scoped like `let`,
   * not hoisted out of it — verified by running
   * `{ function f(){} } f()` under Node, which throws `ReferenceError`.
   * Treating them as hoisted would have made a function declared in an
   * unrelated block shadow a genuine loader call outside it. Declarations at
   * the scope's own level are already handled by `declaredDirectlyIn`.
   */
  const hoistedVarIn = (scope: ts.Node): boolean => {
    let found = false;
    const visit = (child: ts.Node): void => {
      if (found) return;
      // Anything that introduces its own `var` scope stops the walk: nested
      // functions, class static blocks, and TypeScript namespace bodies. A
      // `var` inside `class C { static { ... } }` is scoped to that block, so
      // treating it as hoisted let a genuine outer loader call go unreported.
      if (
        child !== scope &&
        (ts.isFunctionLike(child) ||
          ts.isClassStaticBlockDeclaration(child) ||
          ts.isModuleDeclaration(child))
      ) {
        return;
      }
      if (
        ts.isVariableStatement(child) &&
        (child.declarationList.flags & ts.NodeFlags.BlockScoped) === 0
      ) {
        for (const declaration of child.declarationList.declarations) {
          if (bindsName(declaration)) found = true;
        }
      }
      ts.forEachChild(child, visit);
    };
    ts.forEachChild(scope, visit);
    return found;
  };

  for (let scope = node.parent; scope !== undefined; scope = scope.parent) {
    if (ts.isBlock(scope) || ts.isFunctionLike(scope) || ts.isSourceFile(scope)) {
      if (declaredDirectlyIn(scope)) return true;
      if ((ts.isFunctionLike(scope) || ts.isSourceFile(scope)) && hoistedVarIn(scope)) return true;
    }
  }
  return false;
}

/**
 * Whether a call target is one of the three receivers that actually load a
 * module: a bare `require(...)`, CommonJS's `module.require(...)`, or Bun's
 * `import.meta.require(...)` — in either the dotted or the computed spelling.
 *
 * Deliberately NOT any `<anything>.require(...)`: an arbitrary object with a
 * `require` method is not a module system, and tests pin that
 * `options.require('...')`, `config.require('...')`, and
 * `new.target.require('...')` stay unreported.
 */
function isModuleLoader(callee: ts.Node): boolean {
  if (ts.isIdentifier(callee) && callee.text === 'require') {
    return !isLocallyShadowed(callee, 'require');
  }

  const member = staticMemberName(callee);
  if (member === undefined || member.name !== 'require') return false;

  if (ts.isIdentifier(member.object) && member.object.text === 'module') {
    return !isLocallyShadowed(member.object, 'module');
  }
  // `import.meta` specifically. `ts.isMetaProperty` alone is also true for
  // `new.target`, whose `require` is a method on an arbitrary object.
  return (
    ts.isMetaProperty(member.object) &&
    member.object.keywordToken === ts.SyntaxKind.ImportKeyword &&
    member.object.name.text === 'meta'
  );
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
      const isRequire = isModuleLoader(callee);
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

    // `ts.forEachChild` does not traverse JSDoc, so `/** @type
    // {import('bun:test').Mock} */` in a `.js` file would never be reached.
    // The same dependency the TypeScript form already bans.
    for (const doc of (node as { jsDoc?: ts.Node[] }).jsDoc ?? []) visit(doc);

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

/**
 * Extensions whose contents are definitely not executable source.
 *
 * Inverted from an allowlist deliberately. An allowlist has to predict every
 * spelling a runnable file might use, and it cannot: `bun bin/run-tests.task`
 * executes JavaScript, so does a file named `.run-tests`, and a case-sensitive
 * list misses `.TS` besides. Listing what is *not* source fails safe — an
 * unrecognised extension gets parsed, and parsing a non-module yields no
 * imports.
 *
 * Markdown is excluded on purpose rather than by accident: documentation
 * legitimately shows the banned import inside a fenced example, and reporting
 * those would make the gate reject its own explanation.
 */
export const NON_SOURCE_EXTENSIONS: readonly string[] = [
  '.md',
  '.mdx',
  '.json',
  '.jsonc',
  '.lock',
  '.yml',
  '.yaml',
  '.toml',
  '.txt',
  '.csv',
  '.sql',
  '.html',
  '.css',
  '.scss',
  '.svg',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.ico',
  '.webp',
  '.avif',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.pdf',
  '.zip',
  '.gz',
  '.tgz',
  '.map',
  '.snap',
];

/** Whether a file's contents could hold a module import. */
export function isScannableFile(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return !NON_SOURCE_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

/**
 * Whether contents look like a binary file rather than source.
 *
 * The only reason to skip an extensionless file. A shebang requirement was
 * the previous filter and it was wrong twice over: `bun bin/run-tests`
 * executes a file with no shebang at all, and the cost it was avoiding does
 * not exist — this repository has two extensionless tracked files, and
 * parsing prose with a TypeScript parser simply yields no imports.
 */
export function looksBinary(contents: string): boolean {
  return contents.slice(0, 8000).includes('\0');
}

/** Whether a path has no extension, so its shebang decides. */
export function isExtensionlessPath(path: string): boolean {
  const base = path.slice(path.lastIndexOf('/') + 1);
  return base.length > 0 && !base.includes('.');
}
