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
 * `import(...)` of the same specifier reports nothing under plain ESLint.
 * Note the limitation is ESLint's specifically — oxlint 1.78 *does* flag the
 * dynamic form, so the eleven oxlint-backed workspaces are already covered
 * there. It is the eslint-only `scripts/` workspace, plus every unlinted path,
 * that needs this backstop for dynamic imports.
 *
 * Pure by design — all filesystem access lives in the script, so these rules
 * stay covered by the 100% gate.
 */

/** A banned import found in one file. */
export type BannedImport = {
  /** 1-indexed line the import begins on. */
  line: number;
  /** The matched text, trimmed and flattened, for the failure report. */
  text: string;
  /** Which import form matched, so the report can explain the rule's reach. */
  form: 'static' | 'dynamic' | 'require';
};

/**
 * The banned specifier, assembled at runtime rather than written as one
 * literal.
 *
 * This module is scanned by the very check it backs. Writing the specifier
 * next to import syntax — which the patterns below unavoidably do — would make
 * this file match itself, and the only escape would be an allowlist. An
 * allowlist in a check whose entire purpose is preventing recurrence is a hole
 * in that purpose, so the source simply never contains the two halves
 * adjacent.
 */
const BANNED_SPECIFIER = ['bun', 'test'].join(':');

/** The specifier as it appears inside quotes, ready for a pattern. */
const QUOTED_SPECIFIER = `['"]${BANNED_SPECIFIER}['"]`;

/**
 * What may sit between tokens: whitespace, a block comment, or a line comment.
 *
 * `import/*c* /('bun:test')` and `import(// reason\n'bun:test')` are both valid
 * JavaScript, and a matcher allowing only `\s*` between the keyword and the
 * parenthesis lets either through — a bypass in a check whose whole job is
 * that it cannot be bypassed.
 *
 * Note this only ever *adds* detections. It is the opposite of stripping
 * comments before matching, which would risk a `//` inside a string
 * truncating a line and hiding a real import after it.
 */
const GAP = String.raw`(?:\s|/\*[\s\S]*?\*/|//[^\n]*\n)*`;

/**
 * The body of a static import between the keyword and `from`.
 *
 * Newlines are deliberately allowed. A formatter routinely produces
 * `import {\n  describe,\n  test,\n} from '...'`, and a matcher anchored on
 * `[^;\n]` stops at the first newline and reports success on exactly the
 * multiline form most likely to appear. Semicolons are still excluded, so the
 * body cannot run past the end of the statement into an unrelated one.
 */
const STATIC_BODY = String.raw`[^;]*?`;

const IMPORT_PATTERNS: ReadonlyArray<{ form: BannedImport['form']; pattern: RegExp }> = [
  // Named, default, namespace, type-only, and re-export forms, single or
  // multiline.
  {
    form: 'static',
    pattern: new RegExp(
      String.raw`(?<![\w.])(?:import|export)\b${STATIC_BODY}\bfrom${GAP}${QUOTED_SPECIFIER}`,
      'g',
    ),
  },
  // Bare side-effect import.
  {
    form: 'static',
    pattern: new RegExp(String.raw`(?<![\w.])import${GAP}${QUOTED_SPECIFIER}`, 'g'),
  },
  // Dynamic import — the form plain ESLint cannot see at all.
  {
    form: 'dynamic',
    pattern: new RegExp(String.raw`(?<![\w.])import${GAP}\(${GAP}${QUOTED_SPECIFIER}${GAP}\)`, 'g'),
  },
  {
    form: 'require',
    pattern: new RegExp(
      String.raw`(?<![\w.])require${GAP}\(${GAP}${QUOTED_SPECIFIER}${GAP}\)`,
      'g',
    ),
  },
];

/** Collapse a possibly-multiline match into one readable report line. */
function flatten(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Deterministic string ordering.
 *
 * Not `localeCompare`: its result depends on the runtime's locale, so the same
 * two findings could be reported in a different order on a developer machine
 * than in CI. `AGENTS.md` requires deterministic comparisons in runtime logic
 * for exactly this reason.
 */
function compareText(first: string, second: string): number {
  if (first < second) return -1;
  if (first > second) return 1;
  return 0;
}

/**
 * Returns every `bun:test` import in `contents`, in line order.
 *
 * A file with no violations returns an empty array, which is what the caller
 * treats as passing — an empty result must never be conflated with "not
 * scanned", so the script counts scanned files separately.
 */
export function findBannedTestRunnerImports(contents: string): BannedImport[] {
  const found: BannedImport[] = [];
  const seen = new Set<string>();

  for (const { form, pattern } of IMPORT_PATTERNS) {
    // `lastIndex` is shared state on a module-scope global regex; reset it so
    // one file's scan cannot start partway through because of the previous
    // file's match position.
    pattern.lastIndex = 0;

    for (const match of contents.matchAll(pattern)) {
      const index = match.index ?? 0;
      // Two patterns can cover the same span (a bare import is a prefix of no
      // other form, but keeping this explicit means adding a pattern later
      // cannot silently double-report).
      const key = `${index}:${match[0].length}`;
      if (seen.has(key)) continue;
      seen.add(key);

      found.push({
        line: contents.slice(0, index).split('\n').length,
        text: flatten(match[0]),
        form,
      });
    }
  }

  return found.sort(
    (first, second) => first.line - second.line || compareText(first.text, second.text),
  );
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
