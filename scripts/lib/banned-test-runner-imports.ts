import ts from 'typescript';
import { parse as parseSvelte } from 'svelte/compiler';

/** The parts of Svelte's AST this module reads. */
type SvelteScript = { content: { start: number; end: number } };
type SvelteRoot = {
  instance?: SvelteScript | null;
  module?: SvelteScript | null;
  // The parsed markup. Typed as `unknown` because it is walked structurally
  // rather than by node kind — see `templateCallRanges`, which deliberately
  // does not enumerate Svelte's grammar.
  fragment?: unknown;
};

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


 * ## What this is for, and where it stops
 *
 * The threat is habit, not adversarial obfuscation: a contributor writing
 * `import { test } from 'bun:test'` out of muscle memory, or example code
 * arriving with a future dependency. Every resolution route here exists
 * because a real reviewer filed a real shape, and roughly a hundred have been
 * closed — aliases, destructuring with defaults, deferred assignment, choice
 * expressions, template folding, member reads through objects and classes,
 * `require.main`, awaited `node:module` imports, Svelte template scopes, and
 * both spellings of every one of them.
 *
 * That set is broad enough to catch anything a developer writes by accident,
 * and it is not a sandbox. Someone determined to smuggle the import past it
 * can: a value that arrives through a function's return, a getter, an
 * `Object.assign`, `eval`, or a cross-module re-export is out of scope, and
 * those boundaries are stated where each resolver declines them and pinned by
 * tests asserting silence. Widening any of them is a decision to make on its
 * own evidence — the lint rule is the primary control, and this is the
 * backstop for the paths lint cannot reach.
 *
 * Stated because the alternative is treating each newly imagined shape as a
 * defect. A guard whose scope is written down can be reasoned about; one whose
 * scope is "whatever has been thought of so far" cannot.
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
/**
 * Exported for `subprocess-deadlines.test.ts`, which had the same gap this
 * solves: `{ timeout: 10 } satisfies SpawnSyncOptions` is erased at run time,
 * and a reader that recognises only a bare object literal sees no deadline.
 * The transparent forms are a property of the node, not of the guard reading
 * it, so both guards ask the same function.
 */
export function unwrapTransparent(node: ts.Node): ts.Node {
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
    // `await x` evaluates to what `x` settles to, and awaiting a non-promise
    // yields it unchanged — so the await is a wrapper either way. This is what
    // makes `const { createRequire } = await import('node:module')` reach the
    // same resolver the unawaited spelling does.
    else if (ts.isAwaitExpression(current)) current = current.expression;
    // `Object.freeze(x)` and `Object.seal(x)` return the very object handed to
    // them, so they wrap a value rather than producing one — and freezing a
    // holder is the idiomatic way to write it. `Object.assign` is deliberately
    // absent: it merges into a target, which is a different value and a
    // different question.
    else if (
      ts.isCallExpression(current) &&
      current.arguments.length === 1 &&
      isObjectPassthrough(current.expression)
    ) {
      const [only] = current.arguments;
      if (only === undefined) return current;
      current = only;
    } else return current;
  }
}

/**
 * The operands a value may arrive from, when an expression chooses among
 * several.
 *
 * Which one runs is the control-flow question this module declines everywhere
 * else, so every operand is a candidate and any match is a match.
 *
 * Answered once here because it was previously answered twice. The specifier
 * resolver and the loader resolver each carried their own copy covering
 * conditionals and arrays, and when the conditional case was added it went
 * into both by hand — but `||`, `&&`, and `??` make exactly the same choice a
 * ternary makes and went into neither. A rule two resolvers each own drifts
 * the moment one of them is corrected alone, which is how three separate
 * findings on this branch happened.
 *
 * The comma operator is deliberately absent: it evaluates to its final operand
 * only, so it is a transparent wrapper rather than a choice, and
 * `unwrapTransparent` already resolves it.
 */
function alternativeOperands(node: ts.Node): readonly ts.Expression[] {
  if (ts.isConditionalExpression(node)) return [node.whenTrue, node.whenFalse];
  if (ts.isBinaryExpression(node)) {
    const chooses =
      node.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
      node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
      node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken;
    return chooses ? [node.left, node.right] : [];
  }
  // An array is a container rather than a choice, but the rule a reader applies
  // to it is the same: any element counts. This is what lets an each block bind
  // from a named list — `{#each [require] as load}` — and following a spread
  // keeps `[...others]` from being a hole in it.
  if (ts.isArrayLiteralExpression(node)) {
    return node.elements.flatMap((element) =>
      ts.isSpreadElement(element) ? [element.expression] : [element],
    );
  }
  return [];
}

/** Whether a callee is `Object.freeze` or `Object.seal`, which return their argument. */
function isObjectPassthrough(callee: ts.Node): boolean {
  return (
    ts.isPropertyAccessExpression(callee) &&
    ts.isIdentifier(callee.expression) &&
    callee.expression.text === 'Object' &&
    // `function run(Object) { Object.freeze(require)(…) }` binds an arbitrary
    // object whose `freeze` returns whatever it likes, so treating the call as
    // an identity operation reported a loader the code never produced. Only the
    // unshadowed global is transparent — the same binding question every other
    // receiver in this module goes through.
    innermostBinding(callee.expression, callee.expression.text, true) === undefined &&
    (callee.name.text === 'freeze' || callee.name.text === 'seal')
  );
}

function constantSpecifier(
  node: ts.Node | undefined,
  seen: ReadonlySet<ts.Node> = new Set(),
): string | undefined {
  if (node === undefined) return undefined;
  // `require(...specifiers)` puts the specifier in a list rather than at the
  // call site. The list is read by the same any-match rule every other list
  // here is.
  if (ts.isSpreadElement(node)) return constantSpecifier(node.expression, seen);
  const current = unwrapTransparent(node);
  if (ts.isStringLiteralLike(current)) return current.text;

  // `import(useBun ? 'bun:test' : 'vitest')` names the runner down one branch,
  // and so do `a || 'bun:test'`, `a ?? 'bun:test'`, and an array of specifiers.
  // All of them are the same question, asked through the shared helper rather
  // than through a copy that has to be corrected here as well.
  const alternatives = alternativeOperands(current);
  if (alternatives.length > 0) {
    const resolved = alternatives
      .map((operand) => constantSpecifier(operand, seen))
      .filter((value): value is string => value !== undefined);
    if (resolved.includes(BANNED_SPECIFIER)) return BANNED_SPECIFIER;
    return resolved[0];
  }

  // A template names the same module the literal does. The unsubstituted form
  // is already a string literal to `isStringLiteralLike`; this is the
  // substituted one, folded through this same resolver so `` `bun:${part}` ``
  // composes with alias resolution. One unresolvable span makes the whole
  // template unknowable rather than partially known — a half-folded specifier
  // would name a module nobody wrote.
  if (ts.isTemplateExpression(current)) {
    let folded = current.head.text;
    for (const span of current.templateSpans) {
      const value = constantSpecifier(span.expression, seen);
      if (value === undefined) return undefined;
      folded += value + span.literal.text;
    }
    return folded;
  }

  // `const runner = 'bun:test'; import(runner)` names the module as statically
  // as writing the literal does. Resolved through the same alias machinery the
  // loader uses rather than a second copy of it, so a chain composes with the
  // fold below: `const a = 'bun:'; const b = a + 'test'; import(b)`.
  if (ts.isIdentifier(current) && !seen.has(current)) {
    const next = new Set([...seen, current]);
    const resolutions = aliasInitializers(current)
      .map((initializer) => constantSpecifier(initializer, next))
      .filter((resolved): resolved is string => resolved !== undefined);
    // Any match is a match, rather than the first resolution winning.
    //
    // A name can hold different values in different scopes, and the collector
    // deliberately does not model which binding a given call sees. Returning
    // the first resolution therefore let an outer, innocuous value mask an
    // inner banned one — a Svelte component declaring `const runner = 'vitest'`
    // in its instance script hid `{@const runner = 'bun:test'}` from a call
    // inside that same block. Preferring the banned value is the same
    // fail-toward-reporting rule the loader resolution already uses.
    if (resolutions.includes(BANNED_SPECIFIER)) return BANNED_SPECIFIER;
    return resolutions[0];
  }

  // `const modules = { tests: 'bun:test' }; import(modules.tests)` names the
  // module as statically as writing the literal does — a routine configuration
  // object, read at a key this file can compute. Shared with the loader
  // resolver, which needs the same read for `holder.load('bun:test')`.
  const fromMember = memberValues(current, seen)
    .map((value) => constantSpecifier(value, new Set([...seen, current])))
    .filter((value): value is string => value !== undefined);
  if (fromMember.includes(BANNED_SPECIFIER)) return BANNED_SPECIFIER;
  if (fromMember.length > 0) return fromMember[0];

  // `import('bun:' + 'test')` names the same module as `import('bun:test')`.
  // Only `+` over operands that are themselves constant is folded — anything
  // involving a variable is not knowable here, and guessing would produce
  // findings nobody can act on.
  if (ts.isBinaryExpression(current) && current.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = constantSpecifier(current.left, seen);
    const right = constantSpecifier(current.right, seen);
    if (left !== undefined && right !== undefined) return left + right;
  }

  return undefined;
}

/**
 * The name a property declares, however it is spelled.
 *
 * An identifier, a string, a number, and a computed key that folds to a
 * constant all name the same property. Every reader of a property name asks
 * this one, because keeping a second identifier-only match is how the
 * destructuring path stayed blind to `{ 'load': require }` after the member
 * path had already been corrected for it.
 */
function staticPropertyName(name: ts.PropertyName | undefined): string | undefined {
  if (name === undefined) return undefined;
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return ts.isComputedPropertyName(name) ? constantSpecifier(name.expression) : undefined;
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
    // would be an inconsistency rather than a decision. A numeric key is read
    // too, because `{ 0: require }` is an object and `h[0]` reads it.
    const indexed = unwrapTransparent(node.argumentExpression);
    const name = ts.isNumericLiteral(indexed)
      ? indexed.text
      : constantSpecifier(node.argumentExpression);
    if (name !== undefined) {
      return { object: unwrapTransparent(node.expression), name };
    }
  }
  return undefined;
}

/**
 * Every value a statically known member read can yield.
 *
 * `const holder = { load: require }; holder.load('bun:test')` reaches the real
 * loader, and `const modules = { tests: 'bun:test' }; import(modules.tests)`
 * reaches the real specifier. Those are one shape, not two: a receiver bound to
 * a declaration this file can see, read at a key it can compute. Answered once
 * so neither resolver grows its own copy — the duplicated "either branch
 * counts" rule next door is what that costs.
 *
 * The boundary is deliberate rather than incidental. A receiver resolves when
 * it is an object literal, or a name bound to one, or a `new` of a class whose
 * property initializer is written in the class body. Values that arrive
 * through construction side effects (`this.load = require` in a constructor),
 * a factory's return, `Object.assign`, a getter, or a key that does not fold
 * to a constant are declined — those are the object-identity and control-flow
 * questions this module declines everywhere else, and answering them by
 * guessing would report calls that load something else entirely.
 */
function memberValues(node: ts.Node, seen: ReadonlySet<ts.Node>): readonly ts.Expression[] {
  // The receiver can be the very member read being resolved — `const holder =
  // { load: holder.load }` is legal to parse — so the node guards itself.
  if (seen.has(node)) return [];
  const guarded = new Set([...seen, node]);

  // `const list = ['bun:test']; import(list[0])` reads out of a list this file
  // can see. Every element counts rather than the indexed one: a list is read
  // by that same any-match rule everywhere else here, and an index that does
  // not fold to a constant is not knowable at all.
  if (ts.isElementAccessExpression(node)) {
    const listsOf = (
      candidate: ts.Node,
      visited: ReadonlySet<ts.Node>,
    ): ts.ArrayLiteralExpression[] => {
      const current = unwrapTransparent(candidate);
      if (ts.isArrayLiteralExpression(current)) return [current];
      if (ts.isIdentifier(current) && !visited.has(current)) {
        const next = new Set([...visited, current]);
        return aliasInitializers(current).flatMap((initializer) => listsOf(initializer, next));
      }
      // `holder.list[0]` — the list is itself behind a member read, resolved by
      // the same function rather than by a second copy of it.
      return memberValues(current, visited).flatMap((value) => listsOf(value, visited));
    };
    // A literal index selects one element and is not a control-flow question,
    // so reading every element there reported a value the code never has:
    // `import(runners[1])` where element one is permitted. The any-match rule
    // belongs to a *dynamic* index, where which element is read is genuinely
    // unknowable — the same boundary this file draws between an override and a
    // branch.
    const index = unwrapTransparent(node.argumentExpression);
    const selected = ts.isNumericLiteral(index) ? Number(index.text) : undefined;
    const elements = listsOf(node.expression, guarded).flatMap((list) => {
      const operands = [...alternativeOperands(list)];
      if (selected === undefined) return operands;
      const element = operands[selected];
      return element === undefined ? [] : [element];
    });
    if (elements.length > 0) return elements;
  }

  const member = staticMemberName(node);
  if (member === undefined) return [];

  /**
   * The value a key actually has, spreads flattened in order and later
   * properties winning.
   *
   * Not the any-match rule the choice resolver uses, and deliberately so. A
   * branch is a control-flow question this module declines, so either operand
   * counts; an override is deterministic and statically visible, so
   * `{ ...base, load: other }` holds `other` and nothing else. Preferring the
   * banned one here would report a value the code never has.
   */
  const effectiveValue = (
    literal: ts.ObjectLiteralExpression,
    visited: ReadonlySet<ts.Node>,
  ): ts.Expression[] => {
    let chosen: ts.Expression[] = [];
    for (const property of literal.properties) {
      if (ts.isSpreadAssignment(property)) {
        for (const source of objectsOf(property.expression, visited)) {
          const inherited = effectiveValue(source, visited);
          if (inherited.length > 0) chosen = inherited;
        }
        continue;
      }
      // Reading `h['load']` and writing `{ ['load']: … }` are the same question
      // asked from opposite ends, so both go through the one property-name
      // reader rather than through two that drift apart.
      if (staticPropertyName(property.name) !== member.name) continue;
      // A method or an accessor named the same thing is not the value: reading
      // its body is evaluating a function, which is declined here and tested.
      chosen = ts.isPropertyAssignment(property)
        ? [property.initializer]
        : // `{ require }` is shorthand for `{ require: require }`.
          ts.isShorthandPropertyAssignment(property)
          ? [property.name]
          : [];
    }
    return chosen;
  };

  /** Every object literal a receiver expression can be. */
  function objectsOf(
    candidate: ts.Node,
    visited: ReadonlySet<ts.Node>,
  ): readonly ts.ObjectLiteralExpression[] {
    const current = unwrapTransparent(candidate);
    if (ts.isObjectLiteralExpression(current)) return [current];
    if (ts.isIdentifier(current) && !visited.has(current)) {
      const next = new Set([...visited, current]);
      return aliasInitializers(current).flatMap((initializer) => objectsOf(initializer, next));
    }
    // `container.holder.load` — the receiver is itself a member read, resolved
    // by the same function rather than by a second copy of it.
    return memberValues(current, visited).flatMap((value) => objectsOf(value, visited));
  }

  /** The class a name is bound to, if it is bound to one. */
  const classNamed = (identifier: ts.Identifier): ts.ClassLikeDeclaration | undefined => {
    const bound = innermostBinding(identifier, identifier.text, true);
    if (bound === undefined) return undefined;
    if (ts.isClassDeclaration(bound)) return bound;
    // `const Holder = class { load = require }` binds a *variable* whose
    // initializer is the class. The declaration form was handled and the
    // expression form was not, which is the same statement-versus-expression
    // pair this module has been corrected for elsewhere.
    if (ts.isVariableDeclaration(bound) && bound.initializer !== undefined) {
      const initializer = unwrapTransparent(bound.initializer);
      if (ts.isClassExpression(initializer)) return initializer;
    }
    return undefined;
  };

  const propertiesOfClass = (
    declaration: ts.ClassLikeDeclaration,
    wantStatic: boolean,
    visitedClasses: ReadonlySet<ts.Node> = new Set(),
  ): ts.Expression[] => {
    const own = declaration.members.flatMap((element) => {
      if (!ts.isPropertyDeclaration(element)) return [];
      // Class property keys follow the same rules object property keys do; an
      // identifier-only check discarded `['load'] = require`.
      if (staticPropertyName(element.name) !== member.name) return [];
      // `C.load` reads a static property and `new C().load` an instance one.
      // Reading both for either spelling would report a class that declares
      // the name on the other side.
      const isStatic =
        element.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.StaticKeyword) ===
        true;
      if (isStatic !== wantStatic) return [];
      return element.initializer === undefined ? [] : [element.initializer];
    });
    if (own.length > 0 || visitedClasses.has(declaration)) return own;

    // A subclass inherits both halves: `class B extends A {}` gives `new B()`
    // A's instance properties and `B` its static ones. Stopping at the class
    // named in the call answers "not declared here" for a property that is
    // declared, one link up.
    const base = declaration.heritageClauses
      ?.filter((clause) => clause.token === ts.SyntaxKind.ExtendsKeyword)
      .flatMap((clause) => clause.types)
      .map((type) => unwrapTransparent(type.expression))
      .find((expression) => ts.isIdentifier(expression));
    if (base === undefined || !ts.isIdentifier(base)) return own;
    const inherited = classNamed(base);
    return inherited === undefined
      ? own
      : propertiesOfClass(inherited, wantStatic, new Set([...visitedClasses, declaration]));
  };

  const receiver = unwrapTransparent(member.object);

  if (ts.isNewExpression(receiver) && ts.isIdentifier(receiver.expression)) {
    const declaration = classNamed(receiver.expression);
    return declaration === undefined ? [] : propertiesOfClass(declaration, false);
  }
  if (ts.isIdentifier(receiver)) {
    const declaration = classNamed(receiver);
    if (declaration !== undefined) return propertiesOfClass(declaration, true);
  }

  /**
   * Values written onto the receiver after it was created.
   *
   * `const holder = {}; holder.load = require` is the member-access twin of
   * `let load; load = require`, which the name resolver has collected since an
   * early round. Any-match rather than last-wins, and the difference is not
   * arbitrary: property order *within* a literal is deterministic and visible,
   * so an override there wins outright, while which of several statements ran
   * is the control-flow question this module declines everywhere.
   *
   * Every assignment in the file is a candidate, filtered by whether its
   * receiver resolves to this same binding — so a different `holder` in
   * another scope contributes nothing.
   */
  const assignedValues = (): readonly ts.Expression[] => {
    if (!ts.isIdentifier(receiver)) return [];
    const binding = innermostBinding(receiver, receiver.text, true);
    if (binding === undefined) return [];
    const values: ts.Expression[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
        const target = staticMemberName(unwrapTransparent(node.left));
        if (
          target?.name === member.name &&
          ts.isIdentifier(target.object) &&
          target.object.text === receiver.text &&
          innermostBinding(target.object, receiver.text, true) === binding
        ) {
          values.push(node.right);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(receiver.getSourceFile());
    return values;
  };

  return [
    ...objectsOf(receiver, guarded).flatMap((literal) => effectiveValue(literal, guarded)),
    ...assignedValues(),
  ];
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
/** The nearest enclosing function of a node, or undefined at the top level. */
function enclosingFunctionOf(from: ts.Node): ts.Node | undefined {
  let scope: ts.Node | undefined = from.parent;
  while (scope !== undefined && !ts.isFunctionLike(scope) && !ts.isSourceFile(scope)) {
    scope = scope.parent;
  }
  return scope !== undefined && ts.isFunctionLike(scope) ? scope : undefined;
}

/** Extensions that are ES modules whatever the nearest `package.json` says. */
function isEsModuleFile(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return lower.endsWith('.mjs') || lower.endsWith('.mts');
}

/**
 * The statement list a scope owns, whatever kind of scope it is.
 *
 * Shared by the shadow walk and the alias collector. They enumerated scopes
 * separately and drifted: `ModuleBlock` and `CaseBlock` were added to one and
 * not the other, so a binding inside a `namespace` resolved for shadowing and
 * not for aliasing.
 */
function scopeStatements(scope: ts.Node): readonly ts.Statement[] | undefined {
  if (ts.isSourceFile(scope) || ts.isBlock(scope) || ts.isModuleBlock(scope))
    return scope.statements;
  if (ts.isCaseBlock(scope)) return scope.clauses.flatMap((clause) => [...clause.statements]);
  // A statement written directly in a clause has the *clause* as its parent,
  // not the block. The shadow walk reaches the block by climbing; the alias
  // collector arrives from a statement and would stop one level short.
  if (ts.isCaseClause(scope) || ts.isDefaultClause(scope)) return scopeStatements(scope.parent);
  return undefined;
}

/**
 * Exported for `subprocess-deadlines.test.ts`.
 *
 * That guard once resolved names by searching the whole file for matching
 * text, which made its answer depend on unrelated declaration order. It no
 * longer resolves values at all — it reports options it cannot read inline —
 * but it still has to decide whether a callee named `spawnSync` is the import
 * or a nested shadow, and that is this question. Lexical binding resolution
 * already exists here and is exercised by hundreds of tests; a second, weaker
 * copy of it next door is the duplication this module keeps being corrected
 * for.
 *
 * `aliasInitializers` was exported alongside it for the value resolver and is
 * private again now that the resolver is gone: an export with no caller is
 * API surface pretending to be a contract.
 */
export function innermostBinding(
  node: ts.Node,
  name: string,
  ignoreOrder = false,
): ts.Node | undefined {
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

  /** Where the call being judged sits, for the `var` ordering rules below. */
  const callStart = node.getStart();

  /**
   * Whether a variable declaration replaces the existing binding *by the time
   * this call runs*.
   *
   * One governing rule, stated once because four rounds of review each found
   * another position that a narrower rule had not anticipated:
   *
   * > A `var` suppresses only when its assignment provably executes before the
   * > call. That holds in exactly two shapes — the declaration and the call sit
   * > in one executed statement sequence with the call after the initializer,
   * > or the call is inside the body of a loop whose header assigns on entry.
   * > Everything else reports.
   *
   * `var` is the whole difficulty because the binding hoists but the **value**
   * does not: it is assigned where the declaration is written, and CommonJS
   * supplies `require` and `module` as live wrapper parameters, so until then a
   * call reaches the real loader. Verified under Node:
   *
   * ```
   * before assign, typeof require: function
   * it loads: function            // require('node:path') worked
   * after assign: custom
   * ```
   *
   * `let` and `const` are exempt from all of it. They create a fresh binding
   * for the whole block, and an access before the declaration is a
   * temporal-dead-zone `ReferenceError` rather than a load, so treating them as
   * shadowing the entire scope cannot hide an import.
   *
   * Deliberately NOT handled, and each fails toward *reporting*, which is the
   * safe direction: plain reassignment (`require = custom;`), and any `var`
   * whose execution needs control-flow analysis to establish — a nested block,
   * a different `switch` clause, a conditional.
   */
  /** The nearest enclosing function, or undefined at the top level. */
  const enclosingFunction = (from: ts.Node): ts.Node | undefined => {
    let scope: ts.Node | undefined = from.parent;
    while (scope !== undefined && !ts.isFunctionLike(scope) && !ts.isSourceFile(scope)) {
      scope = scope.parent;
    }
    return scope !== undefined && ts.isFunctionLike(scope) ? scope : undefined;
  };

  const replacesBinding = (declaration: ts.VariableDeclaration): boolean => {
    // `ignoreOrder` asks a different question: not "has this replaced the
    // loader yet" but "is this name bound here at all". Alias resolution needs
    // the second, because any nearer binding — even a `var` whose assignment
    // has not run — is what the call actually names.
    if (ignoreOrder) return true;

    // The whole positional rule exists because CommonJS supplies `require` and
    // `module` as wrapper *parameters*, so a `var` redeclaration leaves a live
    // loader behind until its assignment runs. An ES module has no wrapper, so
    // the hoisted `var` is `undefined` from the start and the call throws
    // rather than loading — confirmed by running the same source as `.cjs`
    // (loads) and `.mjs` (TypeError). Position is therefore irrelevant there.
    //
    // Only the unambiguous extensions are treated as ES modules. `.ts` and
    // `.js` depend on the nearest `package.json` `type`, which this validator
    // does not read, so they keep the CommonJS reading — the one that reports.
    if (isEsModuleFile(declaration.getSourceFile().fileName)) return true;
    const list = declaration.parent;
    if ((list.flags & ts.NodeFlags.BlockScoped) !== 0) return true;

    // A `var` loop header assigns on entry, so it shadows the body — but the
    // iterable expression is evaluated *before* that assignment, so
    // `for (var require of require('bun:test'))` still reaches the loader.
    // Comparing against the body rather than the declaration separates them.
    const loop = list.parent;
    if (ts.isForOfStatement(loop) || ts.isForInStatement(loop)) {
      return callStart >= loop.statement.getStart();
    }

    if (declaration.initializer === undefined) {
      // A bare `var` preserves the CommonJS wrapper binding only where that
      // binding exists. Inside a nested function the `var` is its own, is
      // `undefined` on entry, and shadows — so the call throws rather than
      // loading. Same scope correction the enum merge rule needed.
      return enclosingFunctionOf(declaration) !== undefined;
    }

    // Source order only tracks execution order within one function body. Across
    // a function boundary it tracks nothing: a hoisted declaration can be
    // invoked before an assignment that is written above it, and the call node
    // still sits textually below.
    //
    //   invoke();
    //   var require = custom;
    //   function invoke() { require('bun:test'); }   // reaches the real loader
    //
    // Verified under Node, where that call loads. So when the call lives in a
    // function the declaration does not, the comparison is refused and the call
    // is reported. That over-reports the common case where the function is
    // called afterwards, which is the safe direction and is taken knowingly.
    if (enclosingFunction(node) !== enclosingFunction(declaration)) return false;
    return callStart >= declaration.initializer.getEnd();
  };

  /**
   * The `switch` clause a node sits in, if any, stopping at the first function
   * boundary so a clause never claims a call inside a nested function.
   */
  const enclosingClause = (from: ts.Node): ts.Node | undefined => {
    // Written as a loop condition rather than an early return inside the body,
    // so the trailing `return` is the normal exit. Every chain ends at a
    // `SourceFile`, so a post-loop fallback would be unreachable — and the
    // coverage gate said so.
    let scope: ts.Node | undefined = from;
    while (scope !== undefined && !ts.isFunctionLike(scope) && !ts.isSourceFile(scope)) {
      if (ts.isCaseClause(scope) || ts.isDefaultClause(scope)) return scope;
      scope = scope.parent;
    }
    return undefined;
  };

  /**
   * Whether an import binding is erased before it reaches the runtime.
   *
   * `import type { load as require }` carries the flag on the clause;
   * `import { type load as require }` carries it on the specifier. Both are
   * erased and introduce nothing, so treating either as a shadow would
   * suppress a real loader call.
   */
  const isTypeOnlyImport = (candidate: ts.ImportSpecifier | ts.NamespaceImport): boolean => {
    if (ts.isImportSpecifier(candidate) && candidate.isTypeOnly) return true;
    const clause = ts.isImportSpecifier(candidate) ? candidate.parent.parent : candidate.parent;
    return ts.isImportClause(clause) && clause.isTypeOnly;
  };

  const bindsName = (candidate: ts.Node): boolean => {
    if (isAmbient(candidate)) return false;
    if (ts.isImportSpecifier(candidate) || ts.isNamespaceImport(candidate)) {
      return !isTypeOnlyImport(candidate) && nameBinds(candidate.name);
    }
    if (ts.isImportClause(candidate)) {
      return !candidate.isTypeOnly && nameBinds(candidate.name);
    }
    if (ts.isVariableDeclaration(candidate)) {
      return replacesBinding(candidate) && nameBinds(candidate.name);
    }
    return (
      // A bodyless overload signature — `function require(n: string): unknown;`
      // — emits nothing, so it introduces no runtime binding even without a
      // `declare` modifier. Only the implementation binds.
      ((ts.isFunctionDeclaration(candidate) && candidate.body !== undefined) ||
        // An `enum` or `namespace` **merges** with an existing binding rather
        // than replacing it: TypeScript emits `(function (X) { ... })(X || (X = {}))`,
        // and in CommonJS `require` is already a truthy wrapper parameter, so
        // the declaration augments the loader and the call still loads.
        //
        // Verified under Bun, same source, two extensions:
        //
        //   .cts  typeof require after enum: function   STILL LOADS
        //   .mts  typeof require after enum: object     throws TypeError
        //
        // So these shadow only where there is nothing to merge with. Ambiguous
        // extensions keep the CommonJS reading, the one that reports — exactly
        // as the `var` rule does, and for the same reason.
        //
        // A `const enum` never binds at all: its members are inlined and
        // `typeof` the name is `'undefined'`.
        ((isEsModuleFile(candidate.getSourceFile().fileName) ||
          // The merge exception exists because the CommonJS *wrapper* binding
          // is what survives. Inside a nested function there is no wrapper
          // binding to merge with, so the declaration really does shadow —
          // verified under Bun, where `typeof require` is `object` inside the
          // function and `function` at the top level.
          enclosingFunctionOf(candidate) !== undefined) &&
          ((ts.isEnumDeclaration(candidate) &&
            (ts.getCombinedModifierFlags(candidate) & ts.ModifierFlags.Const) === 0) ||
            (ts.isModuleDeclaration(candidate) && candidate.body !== undefined))) ||
        ts.isParameter(candidate) ||
        ts.isClassDeclaration(candidate) ||
        ts.isBindingElement(candidate)) &&
      nameBinds(candidate.name)
    );
  };

  /**
   * Bindings introduced by an import statement.
   *
   * Needed because the statement itself is an `ImportDeclaration`, which binds
   * nothing directly — the names live on its clause, its namespace binding, or
   * its specifiers. Without descending, `import { load as require }` never
   * reached `bindsName`, and a call to the imported function was reported as a
   * CommonJS loader.
   */
  const importBinds = (statement: ts.Statement): boolean => {
    if (ts.isImportEqualsDeclaration(statement)) {
      // `import type require = require('./types')` is erased just as
      // `import type { x }` is, so it introduces no runtime binding. The flag
      // lives on the statement for this spelling.
      return !isAmbient(statement) && !statement.isTypeOnly && nameBinds(statement.name);
    }
    if (!ts.isImportDeclaration(statement)) return false;
    const clause = statement.importClause;
    if (clause === undefined) return false;
    if (bindsName(clause)) return true;
    const bindings = clause.namedBindings;
    if (bindings === undefined) return false;
    return ts.isNamespaceImport(bindings)
      ? bindsName(bindings)
      : bindings.elements.some((element) => bindsName(element));
  };

  /**
   * Declarations written directly in this scope's own statement list.
   *
   * Deliberately does not descend into a nested block: `let`, `const`, and
   * `class` are block-scoped, so `{ const require = x; }` binds nothing
   * outside its braces. Treating it as a shadow let a genuine loader call
   * after such a block go unreported — a false negative introduced by an
   * earlier round's fix for the opposite problem.
   */
  const callClause = enclosingClause(node);

  const declaredDirectlyIn = (scope: ts.Node): ts.Node | undefined => {
    let found: ts.Node | undefined;
    // A `switch` body is a `CaseBlock`, not a `Block`, and its clauses share
    // one block scope — `case 'a': const require = x;` binds for every later
    // clause too. An unbraced clause therefore has no `Block` for the walk to
    // find, which is why a braced `case 'x': { ... }` already worked and a bare
    // one did not.
    // Only the `CaseBlock` reading differs from the shared enumeration: clauses
    // share one block scope, so a `const` in any clause binds for the whole
    // switch — but a `var` does not, because control flow enters at one clause
    // and an initializer in another need never have run. Restricting `var` to
    // its own clause is sound because there is no `goto`; fall-through enters a
    // clause at its top, so statements within one clause run in order.
    const statements = ts.isCaseBlock(scope)
      ? scope.clauses.flatMap((clause) =>
          clause === callClause
            ? [...clause.statements]
            : clause.statements.filter(
                (statement) =>
                  !ts.isVariableStatement(statement) ||
                  (statement.declarationList.flags & ts.NodeFlags.BlockScoped) !== 0,
              ),
        )
      : (scopeStatements(scope) ?? functionBodyOf(scope)?.statements);

    if (ts.isFunctionLike(scope)) {
      for (const parameter of scope.parameters) if (bindsName(parameter)) found = parameter;
    }
    for (const statement of statements ?? []) {
      if (bindsName(statement) || importBinds(statement)) found = statement;
      // A classic `for` header's initializer always runs once, before the
      // condition is ever tested, and its `var` outlives the loop — so
      // `for (var require = custom; false; ) {}` really does replace the
      // binding for everything after it. Those declarations sit on the
      // statement rather than in the scope's own list, so they need reaching
      // explicitly; `bindsName` still applies the ordering rule to them.
      const declarations = ts.isVariableStatement(statement)
        ? statement.declarationList.declarations
        : ts.isForStatement(statement) &&
            statement.initializer !== undefined &&
            ts.isVariableDeclarationList(statement.initializer) &&
            // Only `var` outlives the loop. A `let` or `const` header binding
            // ceases to exist at the closing brace, so hoisting it into the
            // enclosing scope suppressed calls written after the loop.
            (statement.initializer.flags & ts.NodeFlags.BlockScoped) === 0
          ? statement.initializer.declarations
          : undefined;
      for (const declaration of declarations ?? []) {
        if (bindsName(declaration)) found = declaration;
      }
    }
    return found;
  };

  /**
   * There is deliberately no hoisted-`var` search any more.
   *
   * `var` is function-scoped, so a declaration inside a nested block does bind
   * across the whole function — but binding is not the question. The question
   * is whether the *assignment* has run by the time the call executes, and for
   * anything nested that cannot be decided lexically:
   *
   * ```js
   * if (false) { var require = custom; }
   * require('bun:test');            // still the real loader
   * ```
   *
   * The initializer precedes the call in source order and never executes.
   * Position was standing in for control-flow dominance, and it is not a
   * substitute for it.
   *
   * Rather than approximate dominance, suppression now requires the strongest
   * form of it that is free: the declaration must be a direct statement of a
   * scope enclosing the call, so the two are in one statement list and run in
   * order. Every nested `var` reports instead, which is the safe direction for
   * a ban. A bare `var` never suppressed anyway, so this only changes the
   * nested-and-initialized case.
   */

  /**
   * Bindings a scope introduces outside any statement list of its own.
   *
   * Three positions live here, and each produced a false positive because the
   * walk below only ever inspected blocks, functions, and source files:
   * a named function or class expression binds its own name inside itself, a
   * catch clause binds its parameter for the catch block, and a loop header
   * binds for the loop body.
   */
  const bindsOutsideStatementList = (scope: ts.Node): ts.Node | undefined => {
    if (ts.isFunctionExpression(scope) || ts.isClassExpression(scope)) {
      return nameBinds(scope.name) ? scope : undefined;
    }
    if (ts.isCatchClause(scope)) {
      return nameBinds(scope.variableDeclaration?.name) ? scope.variableDeclaration : undefined;
    }
    if (ts.isForStatement(scope) || ts.isForOfStatement(scope) || ts.isForInStatement(scope)) {
      const initializer = scope.initializer;
      if (initializer === undefined || !ts.isVariableDeclarationList(initializer)) return undefined;
      return initializer.declarations.find((declaration) => bindsName(declaration));
    }
    return undefined;
  };

  for (let scope = node.parent; scope !== undefined; scope = scope.parent) {
    const outside = bindsOutsideStatementList(scope);
    if (outside !== undefined) return outside;
    if (
      ts.isBlock(scope) ||
      ts.isCaseBlock(scope) ||
      // A `namespace N { ... }` body is a `ModuleBlock`, which is a scope the
      // grammar creates and the node kinds do not name after `Block`.
      ts.isModuleBlock(scope) ||
      ts.isFunctionLike(scope) ||
      ts.isSourceFile(scope)
    ) {
      const inside = declaredDirectlyIn(scope);
      if (inside !== undefined) return inside;
    }
  }
  return undefined;
}

/** Whether a nearer binding of `name` stands between this node and the loader. */
function isLocallyShadowed(node: ts.Node, name: string): boolean {
  return innermostBinding(node, name) !== undefined;
}

/**
 * The argument holding the module specifier, if this call loads a module.
 *
 * Most invocations put it first. `Function.prototype.call` and `.apply` move
 * it, because there the loader is the **receiver** of the invocation method
 * rather than the callee — `require.call(undefined, 'bun:test')` runs the real
 * loader with the specifier second, and `.apply` wraps it in an array. That is
 * a different shape from the transparent callee wrappers `unwrapTransparent`
 * handles: those leave the loader *as* the callee, so unwrapping reaches it,
 * while here unwrapping only ever reaches `call`.
 *
 * Only a literal array is read for `.apply`. A variable holding the arguments
 * is not statically knowable, and guessing would report calls that load
 * something else.
 */
/**
 * The first argument a loader was bound with, if it reached the call through
 * `.bind`.
 *
 * Partial application moves the specifier off the call site, so reading the
 * call's own first argument answers the wrong question in both directions —
 * missing a bound banned specifier, and reporting a bound innocuous one.
 */
function boundFirstArgument(
  callee: ts.Node,
  seen: ReadonlySet<ts.Node> = new Set(),
): ts.Node | undefined {
  const fromBindCall = (candidate: ts.Node): ts.Node | undefined => {
    if (!ts.isCallExpression(candidate)) return undefined;
    const member = staticMemberName(unwrapTransparent(candidate.expression));
    if (member?.name !== 'bind') return undefined;
    return candidate.arguments[1];
  };

  const direct = fromBindCall(callee);
  if (direct !== undefined) return direct;

  if (ts.isIdentifier(callee) && !seen.has(callee)) {
    const next = new Set([...seen, callee]);
    for (const initializer of aliasInitializers(callee)) {
      const found = boundFirstArgument(unwrapTransparent(initializer), next);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

function loaderSpecifierArgument(node: ts.CallExpression): ts.Node | undefined {
  const callee = unwrapTransparent(node.expression);
  if (isModuleLoader(callee)) {
    // `.bind` can pre-apply the specifier, so the effective first argument may
    // not be at the call site at all: `require.bind(null, 'vitest')('bun:test')`
    // loads *vitest*, and `module.require.bind(module, 'bun:test')()` loads the
    // runner from a call with no arguments.
    const preApplied = boundFirstArgument(callee);
    return preApplied ?? node.arguments[0];
  }

  const invoker = staticMemberName(callee);
  if (invoker === undefined) return undefined;
  if (invoker.name !== 'call' && invoker.name !== 'apply') return undefined;
  if (!isModuleLoader(unwrapTransparent(invoker.object))) return undefined;

  const second = node.arguments[1];
  if (invoker.name === 'call') return second;
  return second !== undefined && ts.isArrayLiteralExpression(second)
    ? second.elements[0]
    : undefined;
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
/**
 * The initializer of the **innermost** `const` binding of an identifier.
 *
 * `const load = require; load('bun:test')` loads the runner by a spelling that
 * is ordinary rather than evasive, and a name-only check never saw it.
 *
 * Resolving the innermost binding is the part that matters, and it reuses
 * `innermostBinding` rather than re-deriving scoping a second time. An earlier
 * version walked its own scopes and knew about parameters, function
 * declarations, and variable statements — but not loop headers, catch
 * parameters, named function expressions, or class declarations, so
 * `const load = require; for (const load of loaders) { load('bun:test'); }`
 * reached past the loop binding to the outer alias and reported valid code.
 * Two partial copies of binding resolution is the defect; there is one now.
 *
 * `ignoreOrder` is passed because this asks a different question from
 * shadowing. Shadowing needs to know whether a `var` assignment has executed
 * yet; naming needs only to know that the binding exists, since that is what
 * the call refers to either way.
 *
 * Immutability is deliberately NOT required, and an earlier version requiring
 * it was wrong. `let load = require; load('bun:test')` is ordinary JavaScript
 * that loads the runner — verified under Node — so refusing to follow it fails
 * toward *not* reporting, which is the unsafe direction for a ban. A note in
 * the learnings document claimed the opposite; it was wrong and is corrected.
 *
 * A later reassignment is still not tracked, so an alias pointed elsewhere
 * before the call may be reported. That is the safe direction, taken knowingly.
 */
/**
 * Every initializer that a name is given in the scope that binds it.
 *
 * Usually one. `var` allows several — `var load = require; load('bun:test');
 * var load = custom;` shares one binding with two separately ordered
 * assignments, and the first is active at the call. Taking only the innermost
 * declaration returned the *last* one and suppressed a real load.
 *
 * All of them are returned rather than the one active at the call, because
 * establishing that needs the order analysis this validator refuses elsewhere.
 * Callers treat any match as a match, which fails toward reporting.
 */
export function aliasInitializers(identifier: ts.Identifier): ts.Expression[] {
  const binding = innermostBinding(identifier, identifier.text, true);
  // A default gives a parameter its value exactly as an initializer gives one
  // to a declaration: `function f(load = require) { load('bun:test') }` loads.
  if (binding !== undefined && ts.isParameter(binding)) {
    // A destructured parameter carries its defaults on the binding elements,
    // not on the parameter: `function run({ load = require })` has no parameter
    // initializer at all, so returning that alone found nothing.
    const defaults: ts.Expression[] = [];
    const collect = (name: ts.BindingName): void => {
      if (ts.isIdentifier(name)) return;
      for (const element of name.elements) {
        if (!ts.isBindingElement(element)) continue;
        if (
          element.initializer !== undefined &&
          ts.isIdentifier(element.name) &&
          element.name.text === identifier.text
        ) {
          defaults.push(element.initializer);
        }
        collect(element.name);
      }
    };
    collect(binding.name);
    if (binding.initializer !== undefined) defaults.push(binding.initializer);
    return defaults;
  }
  if (binding === undefined || !ts.isVariableDeclaration(binding)) return [];

  /**
   * The sub-expression a destructuring pattern binds to this name.
   *
   * `const [load] = [require]` and `const { require: load } = module` give the
   * binding a value that is a *part* of the initializer, so pushing the whole
   * initializer asks whether an array or object literal is a loader.
   */
  const throughPattern = (pattern: ts.BindingName, initializer: ts.Expression): ts.Expression[] => {
    const source = unwrapTransparent(initializer);
    if (ts.isIdentifier(pattern)) {
      return pattern.text === identifier.text ? [initializer] : [];
    }
    if (ts.isArrayBindingPattern(pattern) && ts.isArrayLiteralExpression(source)) {
      for (const [index, element] of pattern.elements.entries()) {
        if (!ts.isBindingElement(element)) continue;
        // `const [load = require] = []` — the default is the value the binding
        // receives when the position is absent, so it is an initializer like
        // any other.
        // Both the matched position and the default are candidates: JavaScript
        // applies the default when the value is *explicitly* `undefined`, not
        // only when the position is absent, and which one applies is a runtime
        // question. Any match is a match.
        const candidates = [source.elements[index], element.initializer].filter(
          (value): value is ts.Expression => value !== undefined,
        );
        const found = candidates.flatMap((value) => throughPattern(element.name, value));
        if (found.length > 0) return found;
      }
      return [];
    }
    if (ts.isObjectBindingPattern(pattern) && ts.isObjectLiteralExpression(source)) {
      for (const element of pattern.elements) {
        // `const { 'require': load } = module` is valid and selects the real
        // loader; an identifier-only read of the property name rejected it.
        const key =
          element.propertyName !== undefined
            ? staticPropertyName(element.propertyName)
            : ts.isIdentifier(element.name)
              ? element.name.text
              : undefined;
        if (key === undefined) continue;
        // A quoted key names the same property. The member reader already
        // folded these; this path kept its own identifier-only match, which is
        // the read-side/write-side asymmetry corrected once more.
        const property = source.properties.find(
          (candidate) => staticPropertyName(candidate.name) === key,
        );
        // `const { load = require } = {}` — no matching property, so the
        // default supplies the value.
        const candidates = [
          property !== undefined && ts.isPropertyAssignment(property)
            ? property.initializer
            : undefined,
          element.initializer,
        ].filter((value): value is ts.Expression => value !== undefined);
        const found = candidates.flatMap((value) => throughPattern(element.name, value));
        if (found.length > 0) return found;
      }
    }
    return [];
  };

  // `for (const load of [require])` binds each element in turn, and the loop
  // header is not a `VariableStatement` — so the statement search below finds
  // nothing and the value has to come from the iterable instead.
  //
  // Placed after `throughPattern` rather than with the other early returns: it
  // calls that helper, and a `const` arrow is in its temporal dead zone until
  // its own definition is reached. `tsc` accepted the earlier placement and the
  // validator threw at run time.
  const loop = binding.parent.parent;
  if (
    ts.isForOfStatement(loop) &&
    ts.isArrayLiteralExpression(unwrapTransparent(loop.expression))
  ) {
    const iterable = unwrapTransparent(loop.expression) as ts.ArrayLiteralExpression;
    return iterable.elements.flatMap((element) => throughPattern(binding.name, element));
  }

  const list = binding.parent;
  const statement = list.parent;
  const siblings = ts.isVariableStatement(statement) ? statement.parent : undefined;
  // A binding declared in a loop header is scoped to that loop, and a loop is
  // not a `VariableStatement` — so the scope search found nothing and this
  // returned the declaration's own initializer, losing every assignment the
  // body makes: `for (let load; ; ) { load = require; load('bun:test'); }`.
  // The loop *is* that binding's scope, so the loop is what gets searched, and
  // the traversal below reaches its body like any other statement's.
  const enclosingLoop =
    ts.isForStatement(statement) || ts.isForOfStatement(statement) || ts.isForInStatement(statement)
      ? [statement]
      : undefined;
  const statements = siblings === undefined ? enclosingLoop : scopeStatements(siblings);
  if (statements === undefined)
    return binding.initializer === undefined ? [] : [binding.initializer];

  const initializers: ts.Expression[] = [];
  /**
   * Assignments, in every spelling that gives this name a value.
   *
   * Enumerated together rather than added one report at a time: plain and
   * logical assignment, a chain (`a = load = require`, where the interesting
   * assignment is the right operand of another), and a destructuring assignment
   * to an existing binding.
   */
  const takeAssignment = (candidate: ts.Expression): void => {
    const expression = unwrapTransparent(candidate);
    if (!ts.isBinaryExpression(expression)) return;

    const assigns =
      expression.operatorToken.kind === ts.SyntaxKind.EqualsToken ||
      expression.operatorToken.kind === ts.SyntaxKind.QuestionQuestionEqualsToken ||
      expression.operatorToken.kind === ts.SyntaxKind.BarBarEqualsToken ||
      expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandEqualsToken;
    // No comma-operator case here: `unwrapTransparent` already resolves a comma
    // expression to its final operand, which is the value the assignment
    // produces — so `load = other, load = require` arrives as `load = require`.
    // A branch for it was written, and the coverage gate showed it unreachable.
    if (!assigns) return;

    // One resolver for every target form. Name matching is not enough — the
    // search covers nested functions, so `function wire(load) { ... }` assigns
    // that function's own parameter — and the identifier, array, and object
    // forms each need the same check. They were written separately and each was
    // corrected in a different round.
    const writesThisBinding = (candidate: ts.Node): boolean =>
      ts.isIdentifier(candidate) &&
      candidate.text === identifier.text &&
      innermostBinding(candidate, identifier.text, true) === binding;

    const target = unwrapTransparent(expression.left);
    if (ts.isIdentifier(target)) {
      if (!writesThisBinding(target)) return;
      initializers.push(expression.right);
    } else if (ts.isArrayLiteralExpression(target)) {
      // `[load] = [require]` — the assignment form of array destructuring. The
      // declaration form goes through `throughPattern`; this one has literals
      // on both sides, so the positions are matched directly.
      const source = unwrapTransparent(expression.right);
      if (ts.isArrayLiteralExpression(source)) {
        for (const [index, element] of target.elements.entries()) {
          const bound = unwrapTransparent(element);
          if (!writesThisBinding(bound)) continue;
          const value = source.elements[index];
          if (value !== undefined) initializers.push(value);
        }
      }
    } else if (ts.isObjectLiteralExpression(target)) {
      // `({ load } = { load: require })` — a destructuring *assignment*, whose
      // left side parses as a literal rather than a binding pattern.
      for (const property of target.properties) {
        const key =
          property.name !== undefined && ts.isIdentifier(property.name)
            ? property.name.text
            : undefined;
        const written = ts.isShorthandPropertyAssignment(property)
          ? property.name
          : ts.isPropertyAssignment(property)
            ? unwrapTransparent(property.initializer)
            : undefined;
        if (key === undefined || written === undefined || !writesThisBinding(written)) continue;
        const source = unwrapTransparent(expression.right);
        if (!ts.isObjectLiteralExpression(source)) continue;
        // The declaration form was corrected to fold quoted keys and this,
        // the assignment form, kept its own identifier-only match — the same
        // pair of paths, the same asymmetry, one round apart.
        const value = source.properties.find(
          (candidate) => staticPropertyName(candidate.name) === key,
        );
        if (value !== undefined && ts.isPropertyAssignment(value))
          initializers.push(value.initializer);
      }
    }

    // `a = load = require`: the assignment that matters is the right operand.
    takeAssignment(expression.right);
  };

  const takeDeclarations = (list: ts.VariableDeclarationList): void => {
    for (const declaration of list.declarations) {
      if (declaration.initializer === undefined) continue;
      initializers.push(...throughPattern(declaration.name, declaration.initializer));
    }
  };

  for (const sibling of statements) {
    if (ts.isVariableStatement(sibling)) {
      takeDeclarations(sibling.declarationList);
      // No `continue`: `const configured = (load = require)` declares one name
      // and assigns another, so the statement has to go through the assignment
      // search as well.
    }
    // A classic `for` header declares into this scope when it uses `var`, and
    // its initializer always runs — so it is one of the assignments this
    // binding receives, alongside any plain declaration of the same name.
    if (ts.isForStatement(sibling) && sibling.initializer !== undefined) {
      if (ts.isVariableDeclarationList(sibling.initializer)) {
        if ((sibling.initializer.flags & ts.NodeFlags.BlockScoped) === 0) {
          takeDeclarations(sibling.initializer);
        }
        // No `continue`: the header declares and the *body* can assign, so
        // `for (let i = 0; ...) { load = require; }` needs the search below.
      }
      // `for (load = require; false; )` — a header that assigns rather than
      // declares. It combines the two routes handled either side of this: a
      // loop initializer that always runs, and an assignment as the place a
      // value arrives. Neither branch saw it on its own.
      if (!ts.isVariableDeclarationList(sibling.initializer)) {
        takeAssignment(sibling.initializer);
      }
      // Still no `continue`: the body is searched below like any other
      // statement's, which is where `for (...) { load = require; }` lives.
    }
    // `let load; load = require;` splits declaration from initialization, so
    // the assignment is where the value arrives. Which assignment is live at
    // the call is not established — every one is a candidate and any match is a
    // match, which fails toward reporting.
    // Assignments are searched through the whole statement, not only at its
    // top level: `if (useBun) { load = require; }` assigns the same binding,
    // and so does one written inside a nested function. Which of them runs is
    // the control-flow question this validator declines everywhere else, so
    // every one is a candidate.
    const visitForAssignments = (node: ts.Node): void => {
      if (ts.isBinaryExpression(node)) takeAssignment(node);
      ts.forEachChild(node, visitForAssignments);
    };
    visitForAssignments(sibling);
  }
  return initializers;
}

/**
 * Whether a call loads `node:module`, by either spelling.
 *
 * `require('node:module')` needs a verified loader callee; `import('node:module')`
 * is a call whose callee is the `import` keyword rather than a name, so the
 * loader check rejects it — and that is what hid
 * `const { createRequire } = await import('node:module')`.
 */
function isNodeModuleRequireCall(call: ts.CallExpression): boolean {
  const dynamic = call.expression.kind === ts.SyntaxKind.ImportKeyword;
  if (!dynamic && !isModuleLoader(unwrapTransparent(call.expression))) return false;
  const target = constantSpecifier(call.arguments[0]);
  return target === 'node:module' || target === 'module';
}

/**
 * Whether a name was introduced by importing `exportName` from `node:module`.
 *
 * Resolves the *imported* symbol rather than the local name, because
 * `import { createRequire as makeRequire }` renames it, and provenance rather
 * than spelling is what makes it Node's loader factory. Pass `'*'` to ask
 * whether the name is a namespace import of the module itself.
 */
function isNodeModuleImport(identifier: ts.Identifier, exportName: string): boolean {
  const binding = innermostBinding(identifier, identifier.text, true);
  if (binding === undefined) return false;

  // The CommonJS spellings bind the module object itself, so they answer only
  // the '*' question. Bun supports both, and both load:
  //   import Module = require('node:module')
  //   const Module = require('node:module')
  if (!ts.isImportDeclaration(binding)) {
    if (exportName !== '*') return false;
    // `import M = require('x')` is TypeScript syntax, not a call: its
    // `ExternalModuleReference` holds the specifier directly. `const M =
    // require('x')` really is a call, and its callee still has to be a loader.
    if (ts.isImportEqualsDeclaration(binding)) {
      if (!ts.isExternalModuleReference(binding.moduleReference)) return false;
      const target = constantSpecifier(binding.moduleReference.expression);
      return target === 'node:module' || target === 'module';
    }
    if (!ts.isVariableDeclaration(binding) || binding.initializer === undefined) return false;
    const required = unwrapTransparent(binding.initializer);
    if (!ts.isCallExpression(required)) return false;
    if (!isModuleLoader(unwrapTransparent(required.expression))) return false;
    const target = constantSpecifier(required.arguments[0]);
    return target === 'node:module' || target === 'module';
  }

  const from = constantSpecifier(binding.moduleSpecifier);
  if (from !== 'node:module' && from !== 'module') return false;

  const clause = binding.importClause;
  if (clause === undefined) return false;

  // `import Module from 'node:module'` — both Node and Bun expose the loader
  // factory on the default export, so a default import is provenance for the
  // module object just as a namespace import is.
  if (exportName === '*' && clause.name !== undefined && clause.name.text === identifier.text) {
    return true;
  }

  const named = clause.namedBindings;
  if (named === undefined) return false;
  if (ts.isNamespaceImport(named)) return exportName === '*';
  return named.elements.some(
    (element) =>
      element.name.text === identifier.text &&
      (element.propertyName?.text ?? element.name.text) === exportName,
  );
}

/**
 * Whether an expression is Node's `createRequire`, which returns a real loader.
 *
 * Not a hypothetical spelling: this repository already calls it in
 * `packages/test/src/database.ts` and `packages/mcp/src/logger.ts`, and
 * `const require = createRequire(import.meta.url)` is *the* conventional way to
 * reach CommonJS from an ES module.
 *
 * Decided by provenance in both spellings, which is what a first version got
 * wrong in each direction: it matched the local name literally, so an aliased
 * import slipped past, and it accepted any `.createRequire` member, so an
 * unrelated `helpers.createRequire` was reported as a loader.
 */
function isCreateRequire(callee: ts.Node, seen: ReadonlySet<ts.Node> = new Set()): boolean {
  if (ts.isIdentifier(callee)) {
    if (isNodeModuleImport(callee, 'createRequire')) return true;
    if (isDestructuredFromNodeModule(callee, 'createRequire')) return true;

    // A local rebinding is still the same factory: `const makeRequire =
    // createRequire`. Following it costs one recursion and closes the whole
    // family, rather than the one spelling that happened to be reported.
    if (!seen.has(callee)) {
      // Every candidate, not the first. The collector can return several — a
      // declaration and a later assignment — and `isModuleLoader` already tests
      // them all; stopping at the first let `let factory = other; factory =
      // createRequire` resolve to `other` and pass.
      const next = new Set([...seen, callee]);
      return aliasInitializers(callee).some((initializer) =>
        isCreateRequire(unwrapTransparent(initializer), next),
      );
    }
    return false;
  }

  const member = staticMemberName(callee);
  if (member === undefined || member.name !== 'createRequire') return false;

  // `require('node:module').createRequire` reaches the factory without ever
  // naming the module object, so there is no identifier to resolve — the
  // receiver is the call itself.
  const receiver = unwrapTransparent(member.object);
  if (ts.isCallExpression(receiver)) return isNodeModuleRequireCall(receiver);
  // Followed through aliases, exactly as the CommonJS `module` receiver is.
  // These two paths reach the same kind of object and had drifted apart: one
  // resolved a chain, the other compared against the import directly.
  return ts.isIdentifier(receiver) && resolvesToNodeModule(receiver, new Set());
}

/** Whether an identifier resolves, through any number of aliases, to `node:module`. */
function resolvesToNodeModule(identifier: ts.Identifier, seen: ReadonlySet<ts.Node>): boolean {
  if (seen.has(identifier)) return false;
  if (isNodeModuleImport(identifier, '*')) return true;
  const next = new Set([...seen, identifier]);
  return aliasInitializers(identifier).some((initializer) => {
    const source = unwrapTransparent(initializer);
    return ts.isIdentifier(source) && resolvesToNodeModule(source, next);
  });
}

/**
 * Whether a name was destructured out of `node:module`, as in
 * `const { createRequire } = require('node:module')`.
 *
 * A separate question from an import binding: the declaration is a variable
 * whose name is a binding pattern, so there is no import node to inspect and
 * the provenance lives in the initializer instead.
 */
function isDestructuredFromNodeModule(identifier: ts.Identifier, exportName: string): boolean {
  const binding = innermostBinding(identifier, identifier.text, true);
  if (binding === undefined || !ts.isVariableDeclaration(binding)) return false;
  if (!ts.isObjectBindingPattern(binding.name) || binding.initializer === undefined) return false;

  const takesExport = binding.name.elements.some(
    (element) =>
      ts.isIdentifier(element.name) &&
      element.name.text === identifier.text &&
      (element.propertyName !== undefined && ts.isIdentifier(element.propertyName)
        ? element.propertyName.text
        : element.name.text) === exportName,
  );
  if (!takesExport) return false;

  const required = unwrapTransparent(binding.initializer);
  // The source may be a name already holding the module rather than a call:
  // `import * as Module from 'node:module'; const { createRequire } = Module`.
  if (ts.isIdentifier(required)) return resolvesToNodeModule(required, new Set());
  // One reader for both spellings, rather than a second copy that would need
  // the dynamic-import case added to it separately.
  return ts.isCallExpression(required) && isNodeModuleRequireCall(required);
}

/**
 * There is deliberately no check for a `namespace module` that re-exports
 * `require`, and this is the third disposition of that question.
 *
 * An earlier round treated every enum and namespace as shadowing. That was
 * wrong: TypeScript emits `(function (X) { ... })(X || (X = {}))`, so the
 * declaration *merges* with the CommonJS wrapper rather than replacing it.
 *
 * The next round noticed merging is not all-or-nothing — a namespace exporting
 * `require` really does assign `module.require`, verified under Bun — and
 * suppressed the call in that case. That was right about the emit and wrong as
 * a suppression rule: it searched the whole scope, so it also suppressed a call
 * written *above* the namespace, where the assignment has not run; and it
 * recognised only functions and variables, so `export class require {}` still
 * reported. Two false negatives and a false positive, in the round after it
 * landed.
 *
 * Getting it right needs emit-order reasoning — the position of a namespace's
 * generated initializer against the call — which is the same analysis refused
 * for hoisted function invocations one rule over, and for the same reason. So
 * a CommonJS `namespace module` no longer suppresses anything. The cost is a
 * false positive on code that shadows the CommonJS module object and re-exports
 * `require` from it, which is not something written by accident; this validator
 * is a lint against accidents, and reporting deliberate weirdness is the
 * direction it should fail in.
 */
/**
 * Whether a name was destructured off a loader-bearing object, as in
 * `const { require: load } = module`.
 *
 * Alias following cannot answer this on its own: the declaration's initializer
 * is the whole object, so following it asks "is `module` a loader" rather than
 * "is `module.require` one". The property the binding element selects is what
 * matters, and it is only visible on the element.
 */
function destructuredLoaderProperty(identifier: ts.Identifier): boolean {
  const binding = innermostBinding(identifier, identifier.text, true);
  if (binding === undefined || !ts.isVariableDeclaration(binding)) return false;
  if (!ts.isObjectBindingPattern(binding.name) || binding.initializer === undefined) return false;

  // `const { 'require': load } = module` selects the same property an
  // identifier key does. Every read of a property name in this module goes
  // through the one folder; this was the last that did not.
  const takesRequire = binding.name.elements.some(
    (element) =>
      ts.isIdentifier(element.name) &&
      element.name.text === identifier.text &&
      (element.propertyName !== undefined
        ? staticPropertyName(element.propertyName)
        : element.name.text) === 'require',
  );
  if (!takesRequire) return false;

  const source = unwrapTransparent(binding.initializer);
  // Resolved through the alias chain, as the member-access path already is:
  // `const commonjsModule = module; const { require: load } = commonjsModule`.
  return ts.isIdentifier(source) && resolvesToModuleObject(source, new Set());
}

/** Whether an identifier resolves, through any number of aliases, to `module`. */
/**
 * Whether an expression is the CommonJS module object, in any spelling.
 *
 * `require.main` is Node's own API for the entry module, so `require.main.require`
 * is a real loader — and it is a member access rather than a name, which is why
 * the identifier-only resolver could not see it.
 */
function isModuleObjectExpression(node: ts.Node, seen: ReadonlySet<ts.Node>): boolean {
  const current = unwrapTransparent(node);
  if (ts.isIdentifier(current)) return resolvesToModuleObject(current, seen);
  const member = staticMemberName(current);
  if (member === undefined || !ts.isIdentifier(member.object)) return false;
  // `require.main` and `process.mainModule` are the same object under two of
  // Node's own names, so a `.require` on either is the real loader.
  const owner = member.object.text;
  const named =
    (member.name === 'main' && owner === 'require') ||
    (member.name === 'mainModule' && owner === 'process');
  return named && !isLocallyShadowed(member.object, owner);
}

function resolvesToModuleObject(identifier: ts.Identifier, seen: ReadonlySet<ts.Node>): boolean {
  if (seen.has(identifier)) return false;
  // A direct, unshadowed `module` is the object. When it *is* shadowed the
  // enquiry continues rather than ending, because `var module = module`
  // redeclares the binding and assigns its existing value straight back.
  if (identifier.text === 'module' && !isLocallyShadowed(identifier, 'module')) return true;
  const next = new Set([...seen, identifier]);
  return aliasInitializers(identifier).some((initializer) => {
    const source = unwrapTransparent(initializer);
    return ts.isIdentifier(source) && resolvesToModuleObject(source, next);
  });
}

function isModuleLoader(callee: ts.Node, seen: ReadonlySet<ts.Node> = new Set()): boolean {
  // `createRequire(import.meta.url)('bun:test')` calls the loader that call
  // returns, so the callee here is itself a call rather than a name.
  // `useBun ? require : custom` is a loader down one branch, and so are
  // `custom || require`, `custom ?? require`, and `[require]`. Which one runs
  // is the control-flow question declined everywhere else, so any of them
  // being a loader is enough. Read through the shared helper rather than a
  // second copy — the copy that lived here covered conditionals and arrays and
  // silently did not cover the logical operators.
  const alternatives = alternativeOperands(callee);
  if (alternatives.length > 0) {
    return alternatives.some((operand) => isModuleLoader(unwrapTransparent(operand), seen));
  }

  if (ts.isCallExpression(callee)) {
    const producer = unwrapTransparent(callee.expression);
    if (isCreateRequire(producer)) return true;

    // `module.require.bind(module)` evaluates to the loader itself, so an alias
    // holding it is a loader. The `.bind` sits on the call's callee rather than
    // on the node, and the receiver must resolve as a loader in its own right —
    // a bind on anything else stays silent.
    const bound = staticMemberName(producer);
    if (bound?.name === 'bind' && isModuleLoader(unwrapTransparent(bound.object), seen)) {
      return true;
    }
  }

  if (ts.isIdentifier(callee)) {
    if (callee.text === 'require' && !isLocallyShadowed(callee, 'require')) return true;

    // Follow an immutable alias, and its aliases. This runs for `require` too,
    // because `const require = createRequire(import.meta.url)` shadows the name
    // with a binding that is still a loader — the shadow check above correctly
    // says "not the CommonJS wrapper" and would otherwise end the enquiry.
    // `seen` guards against a cycle only invalid source could produce.
    if (destructuredLoaderProperty(callee)) return true;

    if (!seen.has(callee)) {
      const next = new Set([...seen, callee]);
      return aliasInitializers(callee).some((initializer) =>
        isModuleLoader(unwrapTransparent(initializer), next),
      );
    }
    return false;
  }

  const member = staticMemberName(callee);
  if (member === undefined) return false;

  // `const holder = { load: require }; holder.load('bun:test')` reaches the
  // real loader through a property whose name is arbitrary, so the
  // `require`-named check below cannot see it. Read through the same helper
  // the specifier resolver uses.
  const guarded = new Set([...seen, callee]);
  if (memberValues(callee, seen).some((value) => isModuleLoader(unwrapTransparent(value), guarded)))
    return true;

  if (member.name !== 'require') return false;

  if (isModuleObjectExpression(member.object, seen)) return true;

  if (ts.isIdentifier(member.object)) {
    // Every identifier receiver goes through the one resolver, recursively:
    // `const first = module; const second = first` is still the module object,
    // and `var module = module` redeclares the binding while assigning its own
    // value back. A `text === 'module'` shortcut here used to return first and
    // answered the second case "shadowed, therefore not the loader". An
    // arbitrary object carrying a `require` method still fails.
    return resolvesToModuleObject(member.object, seen);
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
      const specifier = isDynamicImport ? node.arguments[0] : loaderSpecifierArgument(node);
      if (specifier !== undefined && constantSpecifier(specifier) === BANNED_SPECIFIER) {
        record(node, isDynamicImport ? 'dynamic' : 'require');
      }
    }
    // `/** @import { test } from 'bun:test' */`, TypeScript's JSDoc import
    // form, which is how a plain `.js` file writes what `import type` writes in
    // TypeScript. Handled separately from everything else here because
    // `ts.forEachChild` does not descend into JSDoc at all — the tag is not a
    // child node, so no visitor branch could ever have reached it. Only nodes
    // that actually own a JSDoc comment are asked, which keeps this off the
    // hot path.
    // Written as its own statement rather than a link in the chain below. As
    // an `if` immediately preceding an `else if`, it swallowed every remaining
    // branch for any node that merely *owns* a documentation comment — so
    // `/** ... */ import suite = require('bun:test')` went unreported purely
    // because it was documented.
    if ((node as { jsDoc?: readonly unknown[] }).jsDoc !== undefined) {
      for (const tag of ts.getJSDocTags(node)) {
        if (
          ts.isJSDocImportTag(tag) &&
          constantSpecifier(tag.moduleSpecifier) === BANNED_SPECIFIER
        ) {
          record(tag, 'static');
        }
      }
    }

    // `type T = import('...').X`, TypeScript's import-type expression. It is
    // neither a declaration nor a call, so nothing above sees it — and the
    // equivalent `import type { X } from '...'` is already banned, so missing
    // this would leave an inconsistent rule.
    // A fresh chain: the JSDoc check above is an independent statement, so
    // these must not be its alternates.
    if (ts.isImportTypeNode(node)) {
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

  // Analysed as TWO programs, because Svelte gives a component two scopes.
  //
  // A `<script module>` binding is not visible to the instance script or to
  // markup, so composing both into one source let a module-scope value be
  // considered for a markup call — and the resolver prefers a banned value, so
  // a valid component was reported. Each scope is masked and analysed on its
  // own: the module script alone, then the instance script together with the
  // markup that can see it.
  //
  // Masking rather than concatenating keeps every byte offset, so both passes
  // report the line the code is actually written on and results merge without
  // any mapping back.
  const maskTo = (regions: { start: number; end: number }[], extra: string[] = []): string => {
    let masked = '';
    for (let index = 0; index < contents.length; index += 1) {
      const character = contents.charAt(index);
      const inRegion = regions.some(({ start, end }) => index >= start && index < end);
      masked += character === '\n' || inRegion ? character : ' ';
    }
    return extra.length > 0 ? `${masked}\n${extra.join('\n')}` : masked;
  };

  const moduleScript = root.module ? [root.module.content] : [];
  if (moduleScript.length > 0) {
    found.push(...findBannedTestRunnerImports(maskTo(moduleScript), 0, 'component.ts'));
  }

  const instanceScope = [
    ...(root.instance ? [root.instance.content] : []),
    ...templateCallRanges(root.fragment),
  ];
  found.push(
    ...findBannedTestRunnerImports(
      maskTo(instanceScope, templateEachBindings(root.fragment, contents)),
      0,
      'component.ts',
    ),
  );

  // Both passes see the same markup offsets, so a finding reachable from either
  // scope would otherwise appear twice.
  const seen = new Set<string>();
  const deduped = found.filter((finding) => {
    const key = `${finding.line}:${finding.form}:${finding.text}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  found.length = 0;
  found.push(...deduped);

  return found.sort((first, second) => first.line - second.line);
}

/**
 * Declarations standing in for the bindings an `{#each}` introduces.
 *
 * Emitted as text rather than kept as ranges, because the binding is created by
 * the block itself — there is no declaration in the source to preserve.
 */
/**
 * Whether a template subtree contains a call that actually uses this binding.
 *
 * Emitting the synthetic declaration for any call in the block was too loose:
 * a block calling something unrelated exported its local name to the top level,
 * where it became a candidate for markup outside the block.
 */
/**
 * Whether a name is passed as the specifier to a call written `require(...)`.
 *
 * `{#each ['bun:test'] as runner}{require(runner)}{/each}` executes the real
 * loader with the each binding, but the binding is in *argument* position, and
 * `referencesName` deliberately looks only at a callee or an import's source.
 *
 * Kept as its own predicate rather than folded into that one, because the two
 * callers need different rules. Emitting the synthetic each declaration wants
 * this wider view; suppressing a call bound by a snippet parameter must not
 * have it, or `{#snippet render(choice)}{require(choice ? 'vitest' : 'bun:test')}`
 * would be discarded whole and a real banned import would go unreported.
 *
 * Narrow on purpose: only a callee literally named `require`. Anything looser
 * re-creates the `{foo(runner)}` false positive `referencesName` exists to
 * prevent, and over-emission plus the resolver's banned-value preference is
 * how the `{@const}` false positive happened. Residual, stated rather than
 * left to be found: a loader reached through an *alias* in markup —
 * `{load(runner)}` — is not covered here, because deciding that `load` is a
 * loader needs the binding resolver, which runs on the composed program rather
 * than on the template AST.
 */
/** Every identifier a Svelte each-context binds, pattern or not. */
function patternNames(context: unknown): string[] {
  const names: string[] = [];
  const walk = (node: unknown): void => {
    if (node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    const record = node as { type?: unknown; name?: unknown };
    if (record.type === 'Identifier' && typeof record.name === 'string') names.push(record.name);
    for (const [key, value] of Object.entries(node)) {
      if (key === 'parent') continue;
      walk(value);
    }
  };
  walk(context);
  return names;
}

/**
 * Whether a snippet parameter is the *callee* of a call in this range.
 *
 * The suppression exists because a snippet's parameters bind names for its
 * body, so `{#snippet row(require)}{require('bun:test')}` invokes the
 * parameter rather than the loader. It used `referencesName`, which also
 * matches an import's *source* — and that was wrong in a way my rebuttal of an
 * earlier report missed: for `{#snippet render(choice)}{#await import(choice ?
 * 'vitest' : 'bun:test')}`, the specifier is a ternary over two literals that
 * the resolver reads perfectly well, and discarding the range hid a real
 * banned import. The `require(...)` fixture I checked did not exercise that
 * branch, so the rebuttal was right about the fixture and wrong about the
 * concern.
 *
 * Only the callee counts now. A parameter appearing in a specifier leaves the
 * call retained, which is harmless when the specifier is unknowable and correct
 * when it is not.
 */
function shadowsLoader(node: unknown, wanted: unknown): boolean {
  let found = false;
  const visit = (candidate: unknown): void => {
    if (found || candidate === null || typeof candidate !== 'object') return;
    if (Array.isArray(candidate)) {
      for (const item of candidate) visit(item);
      return;
    }
    const record = candidate as { type?: unknown; callee?: unknown };
    const callee = record.callee as { type?: unknown; name?: unknown } | undefined;
    if (
      record.type === 'CallExpression' &&
      callee?.type === 'Identifier' &&
      callee.name === wanted
    ) {
      found = true;
      return;
    }
    for (const [key, value] of Object.entries(candidate)) {
      if (key === 'parent') continue;
      visit(value);
    }
  };
  visit(node);
  return found;
}

function mentionedInRequireArgument(
  node: unknown,
  context: { start?: unknown; end?: unknown; name?: unknown } | undefined,
): boolean {
  if (context === undefined) return false;
  const wanted = (context as { name?: unknown }).name;

  const mentions = (candidate: unknown): boolean => {
    if (candidate === null || typeof candidate !== 'object') return false;
    const record = candidate as { type?: unknown; name?: unknown };
    if (record.type === 'Identifier' && record.name === wanted) return true;
    return Object.entries(candidate).some(([key, value]) => key !== 'parent' && mentions(value));
  };

  let found = false;
  const visit = (candidate: unknown): void => {
    if (found || candidate === null || typeof candidate !== 'object') return;
    if (Array.isArray(candidate)) {
      for (const item of candidate) visit(item);
      return;
    }
    const record = candidate as { type?: unknown; callee?: unknown; arguments?: unknown };
    const callee = record.callee as { type?: unknown; name?: unknown } | undefined;
    if (
      record.type === 'CallExpression' &&
      callee?.type === 'Identifier' &&
      callee.name === 'require' &&
      mentions(record.arguments)
    ) {
      found = true;
      return;
    }
    for (const [key, value] of Object.entries(candidate)) {
      if (key === 'parent') continue;
      visit(value);
    }
  };
  visit(node);
  return found;
}

function referencesName(
  node: unknown,
  context: { start?: unknown; end?: unknown; name?: unknown } | undefined,
): boolean {
  if (context === undefined) return false;
  const wanted = (context as { name?: unknown }).name;

  const mentions = (candidate: unknown): boolean => {
    if (candidate === null || typeof candidate !== 'object') return false;
    // No array case: `Object.entries` yields an array's indices, so the generic
    // recursion below already walks one. An explicit branch was written anyway
    // and the coverage gate showed it unreached — removing it leaves the suite
    // green, which is what makes it redundant rather than merely untested.
    const record = candidate as { type?: unknown; name?: unknown };
    if (record.type === 'Identifier' && record.name === wanted) return true;
    return Object.entries(candidate).some(([key, value]) => key !== 'parent' && mentions(value));
  };

  // The *call* has to use the name. Asking whether the block contains a call
  // and separately whether it mentions the name let an unrelated `{foo(runner)}`
  // satisfy both halves and export the binding to the top level.
  let found = false;
  const visit = (candidate: unknown): void => {
    if (found || candidate === null || typeof candidate !== 'object') return;
    if (Array.isArray(candidate)) {
      for (const item of candidate) visit(item);
      return;
    }
    const record = candidate as { type?: unknown; callee?: unknown; source?: unknown };
    // The name has to be used *as* a loader or *as* an import's specifier.
    // Asking only whether some call mentions it let an unrelated `{foo(runner)}`
    // activate the binding — the name was an argument to something else.
    if (record.type === 'ImportExpression' && mentions(record.source)) {
      found = true;
      return;
    }
    if (record.type === 'CallExpression' && mentions(record.callee)) {
      found = true;
      return;
    }
    for (const [key, value] of Object.entries(candidate)) {
      if (key === 'parent') continue;
      visit(value);
    }
  };
  visit(node);
  return found;
}

function templateEachBindings(fragment: unknown, contents: string): string[] {
  const declarations: string[] = [];
  const visit = (node: unknown): void => {
    if (node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    const record = node as {
      type?: unknown;
      expression?: { type?: unknown; elements?: { start?: unknown; end?: unknown }[] };
      context?: { type?: unknown; start?: unknown; end?: unknown };
    };
    if (
      record.type === 'EachBlock' &&
      // Only when the block body holds a call. The synthetic declaration is
      // appended at top level, so emitting it unconditionally would make the
      // block-local binding a candidate for markup *outside* the block —
      // reporting a component whose outer `runner` names something else.
      // Activation asks about the names the context *binds*, which for a
      // destructuring pattern is not the context node itself: `referencesName`
      // reads `.name`, an `ArrayPattern` has none, and the comparison then ran
      // against `undefined` and never matched. Any bound name being read is
      // enough.
      patternNames(record.context).some(
        (name) =>
          referencesName((node as { body?: unknown }).body, { name }) ||
          mentionedInRequireArgument((node as { body?: unknown }).body, { name }),
      ) &&
      // An each context can destructure: `{#each [['bun:test']] as [runner]}`
      // binds through an `ArrayPattern`. The synthetic declaration is written
      // from the *source text* of the context, so a pattern composes with the
      // resolver's own destructuring support rather than needing a second
      // reader here — the identifier case is the degenerate one.
      (record.context?.type === 'Identifier' ||
        record.context?.type === 'ArrayPattern' ||
        record.context?.type === 'ObjectPattern') &&
      typeof record.context.start === 'number' &&
      typeof record.context.end === 'number' &&
      record.expression !== undefined
    ) {
      const name = contents.slice(record.context.start, record.context.end);
      const iterable = record.expression as { start?: unknown; end?: unknown };
      if (typeof iterable.start === 'number' && typeof iterable.end === 'number') {
        // The iterable is emitted whole rather than element by element, so a
        // *named* one works too: `const runners = ['bun:test']` in the instance
        // script is reached by following the alias, which is machinery that
        // already exists. Element extraction only handled a literal written in
        // the markup.
        declarations.push(`const ${name} = ${contents.slice(iterable.start, iterable.end)};`);
      }
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === 'parent') continue;
      visit(value);
    }
  };
  visit(fragment);
  return declarations;
}

/**
 * Source ranges of the calls embedded in a component's markup.
 *
 * The template AST holds ESTree expression nodes with `start`/`end` offsets
 * into the original source, so each call can be handed to the TypeScript
 * detector as text and every existing rule applies to it unchanged.
 *
 * Only `import(...)` and `require(...)` are collected, rather than every
 * expression. Those are the sole banned shapes reachable from markup — a
 * static `import` declaration cannot appear there — and collecting them by
 * *what they are* avoids enumerating Svelte's node kinds, which is the
 * enumeration this module has repeatedly got wrong. Matching stops descending
 * at the outermost call so a nested one is not reported twice.
 */
function templateCallRanges(fragment: unknown): { start: number; end: number }[] {
  const ranges: { start: number; end: number }[] = [];

  /** Every name a snippet's parameter list binds, destructuring included. */
  const parameterNames = (parameters: unknown): string[] => {
    const names: string[] = [];
    const walk = (node: unknown): void => {
      if (node === null || typeof node !== 'object') return;
      if (Array.isArray(node)) {
        for (const item of node) walk(item);
        return;
      }
      const record = node as { type?: unknown; name?: unknown; key?: unknown; value?: unknown };
      if (record.type === 'Identifier' && typeof record.name === 'string') {
        names.push(record.name);
        return;
      }
      // A property's *key* is not a binding: `{#snippet row({ require: load })}`
      // binds `load` and merely names `require`, so walking every identifier
      // recorded a shadow that does not exist and discarded a real banned call.
      if (record.type === 'Property') {
        walk(record.value);
        return;
      }
      for (const [key, value] of Object.entries(node)) {
        if (key === 'parent') continue;
        walk(value);
      }
    };
    walk(parameters);
    return names;
  };

  const visit = (node: unknown, block: unknown, bound: readonly string[]): void => {
    if (node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item, block, bound);
      return;
    }
    const record = node as {
      type?: unknown;
      start?: unknown;
      end?: unknown;
      declarations?: unknown;
    };
    // Every retained range is emitted at the top level of one composed
    // program, which flattens the template's scopes. For a *call* that costs
    // nothing — a call means the same thing wherever it is written. For a
    // `{@const}` it is wrong: the declaration is visible only inside its own
    // block, so hoisting it let an outer call resolve to the inner value, and
    // the resolver prefers a banned one. A template declaration is therefore
    // retained only when a call inside its own block actually reads it, which
    // is the test the each-block binding next door already applies for the
    // same reason.
    //
    // Residual, stated rather than left to be found: when calls both inside
    // and outside the block read the name, the declaration is retained and the
    // outer call is reported too. That is a precision loss on a component that
    // already reports for the inner call — it can neither pass a banned import
    // nor block a component that has none.
    if (
      record.type === 'VariableDeclaration' &&
      block !== undefined &&
      Array.isArray(record.declarations) &&
      !record.declarations.some((declaration) =>
        referencesName(block, (declaration as { id?: { start?: unknown; end?: unknown } }).id),
      )
    ) {
      return;
    }
    if (
      (record.type === 'ImportExpression' ||
        record.type === 'CallExpression' ||
        // A function expression is retained *whole*, before its call. An event
        // handler binds names — `onclick={(require) => require('bun:test')}` —
        // and keeping only the inner call masked the parameter that shadows the
        // loader, so a valid component was reported.
        record.type === 'ArrowFunctionExpression' ||
        record.type === 'FunctionExpression' ||
        // `{@const runner = 'bun:test'}` declares a binding a markup call can
        // use. Keeping only calls masked the declaration, so the composed
        // program had the alias but not its definition — the very thing
        // composing was meant to fix, one scope further in.
        record.type === 'VariableDeclaration') &&
      typeof record.start === 'number' &&
      typeof record.end === 'number'
    ) {
      // A snippet's parameters bind names for its body, and they live on the
      // Svelte block rather than on a JavaScript function — so masking the
      // markup around a call dropped them, and `{#snippet row(require)}` then
      // read as the unshadowed CommonJS loader. Retaining an arrow function
      // whole solves the same problem for `onclick={(require) => …}`; a snippet
      // has no node to retain, so a call bound by one of its parameters is left
      // out instead. That is the same answer, reached from the other side: the
      // call invokes the parameter, so there is nothing here to report.
      if (bound.some((name) => shadowsLoader(node, name))) return;
      ranges.push({ start: record.start, end: record.end });
      return;
    }
    // Svelte names every template block `*Block` — `IfBlock`, `EachBlock`,
    // `AwaitBlock`, `KeyBlock`, `SnippetBlock`. Matching the suffix rather than
    // listing them avoids the node-kind enumeration this module has repeatedly
    // got wrong, and a block kind added later is covered by the same rule.
    const nested = typeof record.type === 'string' && record.type.endsWith('Block') ? node : block;
    const inner =
      record.type === 'SnippetBlock'
        ? [...bound, ...parameterNames((node as { parameters?: unknown }).parameters)]
        : bound;
    for (const [key, value] of Object.entries(node)) {
      if (key === 'parent') continue;
      visit(value, nested, inner);
    }
  };
  visit(fragment, undefined, []);
  return ranges;
}

/**
 * Last-resort reader for a component Svelte's own parser rejected. Extracts
 * `<script>` blocks textually and parses each as TypeScript, so an import is
 * still found rather than silently missed.
 */
function findBannedImportsInUnparseableSvelte(contents: string): BannedImport[] {
  const found: BannedImport[] = [];
  // Known residual: this reads `<script>` blocks only, so a banned call written
  // in *markup* — `{#await import('bun:test')}` — is invisible when the parser
  // has failed. The real path covers it; recovering template expressions from
  // unparseable markup would need the grammar this fallback exists because it
  // could not use. Named here rather than left to be rediscovered.
  //
  // Deliberately does NOT try to skip commented-out markup.
  //
  // A previous round blanked `<!-- ... -->` spans here, so a commented-out
  // `<script>` would not be reported. That was wrong twice over. The comment
  // above `parseSvelte` had already named the exact spelling that breaks it —
  // `{'<!--'}` in a Svelte expression — and it does: delimiters written either
  // side of a real script blank the script itself, so a genuine banned import
  // goes unreported. And it inverted this fallback's stated contract, which is
  // to fail *closed*.
  //
  // That contract is the right one. This runs only for a component Svelte's
  // own parser rejected, so a false positive here costs a clear failure on a
  // file that is already broken, while a false negative lets a banned import
  // through in exactly the files nothing else can read. Distinguishing a real
  // comment from an expression that looks like one requires Svelte's grammar,
  // and re-deriving that grammar from successive review findings is the
  // mistake this module already made with regular expressions once.
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
  // The shebang decides the language only where nothing else does. A hashbang
  // is a valid JavaScript comment, so `probe.test.mjs` beginning `#!/bin/sh` is
  // still JavaScript — Bun runs it and a `*.test.mjs` vitest project collects
  // it — and skipping it on the shebang alone let a banned suite through.
  const lower = path.toLowerCase();
  const namedByExtension = JAVASCRIPT_EXTENSIONS.some((extension) => lower.endsWith(extension));
  if (!namedByExtension && hasForeignShebang(contents)) return [];
  // Dispatch on the normalised path, not the raw one. The classifier above
  // accepts extensions case-insensitively on purpose, so `Component.SVELTE` is
  // admitted — and then went to the TypeScript reader, which cannot reconstruct
  // a template binding and reported nothing for markup the Svelte reader
  // catches. Two spellings of "is this Svelte" in five lines, disagreeing.
  return lower.endsWith('.svelte')
    ? findBannedImportsInSvelte(contents)
    : findBannedTestRunnerImports(contents, 0, path);
}

/**
 * Extensions the TypeScript parser is allowed to read.
 *
 * This was a blocklist twice, and both spellings of that idea failed the same
 * way. The original reasoning was that an allowlist "has to predict every
 * spelling a runnable file might use, and it cannot" — `bun bin/run-tests.task`
 * executes JavaScript — so listing what is *not* source would fail safe.
 *
 * It does not fail safe, because TypeScript's parser recovers rather than
 * failing. Given `# import 'bun:test'` it lexes the `#` as a stray private
 * identifier and constructs a genuine `ImportDeclaration` from the rest of the
 * line, so an ordinary comment in a foreign language becomes a reported import
 * and the always-on hook rejects every commit. Three review rounds each added
 * the languages observed so far — `.py`, `.sh`, then `.ps1`, `.r` — which is
 * chasing a tail that does not end. Lua goes further: `require('bun:test')` is
 * *valid Lua* that parses as a JavaScript call, so no comment rule would catch
 * it either.
 *
 * Three things settle it the other way:
 *
 * - This repository tracks no exotic-but-JavaScript extension at all. Every
 *   tracked extension is `.ts`, `.js`, `.mjs`, `.svelte`, or plainly not
 *   source, so `run-tests.task` is hypothetical while the false positives are
 *   live and recurring.
 * - The false-negative cost is capped by what this rule is *for*. It bans a
 *   test runner whose suites silently do not run under vitest — and a file no
 *   runner collects cannot be a silently-skipped suite.
 * - The false-positive cost is every commit in the repository.
 *
 * Files with no extension are still read: their shebang decides, which keeps
 * `bun bin/run-tests` — a real entrypoint with no shebang and no extension —
 * inside the gate.
 */
export const JAVASCRIPT_EXTENSIONS: readonly string[] = [
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

/**
 * Basenames that are build recipes or configuration, never JavaScript, and
 * which carry no extension to recognise them by. Matched case-insensitively
 * against the basename up to its first dot, so `Dockerfile.production` is
 * covered as well as `Dockerfile`.
 */
export const NON_SOURCE_BASENAMES: readonly string[] = [
  'dockerfile',
  'containerfile',
  'makefile',
  'gemfile',
  'rakefile',
  'procfile',
  '.env',
  '.gitignore',
  '.gitattributes',
  '.dockerignore',
  '.npmrc',
  '.nvmrc',
  '.editorconfig',
  '.prettierignore',
  '.eslintignore',
];

/** Whether a file's contents could hold a module import. */
export function isScannableFile(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  const base = lower.slice(lower.lastIndexOf('/') + 1);
  // The search starts past a leading dot so `.env.example` reduces to `.env`
  // rather than to the empty string, which matched nothing and let every
  // dotfile variant through.
  const dot = base.indexOf('.', base.startsWith('.') ? 1 : 0);
  const stem = dot === -1 ? base : base.slice(0, dot);
  // A lone leading-dot name is a *named* format, not an extensionless one:
  // `.envrc`, `.babelrc`, `.bashrc` are configuration whose format the name
  // announces. Treating them as extensionless entrypoints handed hash-commented
  // files to the TypeScript parser. `.eslintrc.js` still scans, because its
  // second dot gives it a recognised extension.
  if (base.startsWith('.') && dot === -1) return false;
  // The extension is checked first. A basename exclusion is a heuristic for
  // files whose format nothing else names, and letting it override a
  // recognised extension skipped `runner/Dockerfile.test.mjs` — a file that
  // `runner/vitest.config.mjs` really does collect as a suite. Same mistake as
  // applying the foreign-shebang rule to files whose extension already settled
  // the language.
  if (JAVASCRIPT_EXTENSIONS.some((extension) => lower.endsWith(extension))) return true;
  if (NON_SOURCE_BASENAMES.includes(stem)) return false;
  // No extension at all, so the shebang decides once the contents are read.
  return dot === -1;
}

/**
 * Whether a file's first line hands it to something other than a JavaScript
 * runtime.
 *
 * The complement of a rule this validator deliberately removed earlier, and
 * not a reversal of it. That rule *required* a shebang naming a JavaScript
 * runtime, which wrongly excluded `bun bin/run-tests` — a real entrypoint with
 * no shebang at all. That reason still holds, so a missing shebang still
 * admits the file. Only a shebang naming a foreign interpreter excludes it,
 * which the earlier rule's second justification — that parsing prose is
 * harmless — turns out to require.
 */
export function hasForeignShebang(contents: string): boolean {
  const newline = contents.indexOf('\n');
  const firstLine = newline === -1 ? contents : contents.slice(0, newline);
  if (!firstLine.startsWith('#!')) return false;

  // The interpreter is parsed rather than searched for. Matching `node`
  // anywhere on the line classified `#!/bin/sh # invoke node below` as
  // JavaScript, and the recovery parser then turned that script's ordinary hash
  // comments into imports — a false positive on every commit containing it.
  const tokens = firstLine.slice(2).trim().split(/\s+/).filter(Boolean);
  // `-S` splits its argument, and the pieces may carry quotes: `env -S 'bun'`.
  // Stripping them before taking the basename keeps a quoted interpreter from
  // reading as a foreign one.
  const commandName = (token: string): string => {
    const unquoted = token.replace(/^['"]|['"]$/g, '');
    return unquoted.slice(unquoted.lastIndexOf('/') + 1);
  };
  let interpreter = commandName(tokens[0] ?? '');
  if (interpreter === 'env') {
    // `env` takes options and then environment assignments before the command:
    // its own synopsis is `[-u name] [name=value ...] [utility [argument ...]]`.
    // Skipping only options selected `NODE_OPTIONS=--no-warnings` as the
    // interpreter and wrote off a real JavaScript entrypoint as foreign.
    // Some `env` options take their value as a *separate* operand — its own
    // help documents `-u, --unset=NAME` and `-C, --chdir=DIR`, and the local
    // binary accepts both spellings. Skipping only the option token left its
    // operand looking like the command, so `env -S -u FOO bun` selected `FOO`.
    const takesOperand = new Set(['-u', '--unset', '-C', '--chdir']);
    // `--split-string=bun` carries the command inside the option, so the loop
    // below would skip the only token naming it.
    //
    // The payload is a whole command line, not just a command: `env` splits it
    // and then applies its ordinary rules, so `NAME=value` assignments inside
    // it precede the interpreter exactly as they do outside. Reading the first
    // word unconditionally mistook the assignment for the command and called a
    // runnable Bun entrypoint foreign, skipping every import in it.
    /**
     * The command in an `env` argument list: the first operand that is neither
     * an option, an option's separate value, nor a `NAME=value` assignment.
     *
     * One reader, used for the argument list and for a `--split-string`
     * payload. The payload is a whole command line — `env` splits it and then
     * applies these same rules — so reading its first *word* mistook the
     * assignment in `--split-string=FOO=bar bun` for the interpreter and called
     * a runnable Bun entrypoint foreign. A second, simpler reader for the same
     * grammar is how that happened.
     */
    const commandFrom = (words: readonly string[]): string | undefined => {
      for (let index = 0; index < words.length; index += 1) {
        const token = words[index] ?? '';
        if (token.length === 0) continue;
        if (takesOperand.has(token)) {
          index += 1;
          continue;
        }
        if (token.startsWith('-')) continue;
        if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) continue;
        return token;
      }
      return undefined;
    };

    // `--split-string=S` splits `S` into words *in place* and then keeps
    // processing the rest of the argument list, so the command can be inside
    // the payload (`--split-string=bun`), after it
    // (`--split-string=FOO=bar bun`), or after options the payload introduces.
    // Expanding the token and reading the whole list models that; reading the
    // payload alone found nothing in the second case and called a runnable Bun
    // entrypoint foreign.
    const expanded = tokens
      .slice(1)
      .flatMap((token) =>
        token.startsWith('--split-string=')
          ? token.slice('--split-string='.length).trim().split(/\s+/)
          : [token],
      );
    interpreter = commandName(commandFrom(expanded) ?? '');
  }
  return interpreter !== 'node' && interpreter !== 'bun' && interpreter !== 'deno';
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
