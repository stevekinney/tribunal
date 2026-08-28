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
 * It also catches what `no-restricted-imports` structurally cannot: that rule
 * matches static import and export declarations only, so a dynamic
 * `import(...)` of the same specifier reports nothing at all.
 *
 * Pure by design — all filesystem access lives in the script, so these rules
 * stay covered by the 100% gate.
 */

/** A banned import found in one file. */
export type BannedImport = {
  /** 1-indexed line the import appears on. */
  line: number;
  /** The matched text, trimmed, for the failure report. */
  text: string;
  /** Which import form matched, so the report can explain the rule's reach. */
  form: 'static' | 'dynamic' | 'require';
};

/**
 * Each pattern is anchored on a leading non-identifier character so a longer
 * identifier ending in the keyword cannot match (`myimport('bun:test')`), and
 * excludes a preceding `.` so a property access cannot either
 * (`options.require('bun:test')` is not a module system call).
 *
 * They deliberately match the import SYNTAX rather than the bare specifier.
 * `.oxlintrc.json` and this file both contain the string `'bun:test'` as
 * configuration and test data; a check that flagged its own rule definition
 * would be unusable.
 */
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
 * Each pattern is anchored with a negative lookbehind so a longer identifier
 * ending in the keyword cannot match, and so a property access cannot either —
 * a `.require(...)` call is not a module system call.
 *
 * They deliberately match import SYNTAX rather than the bare specifier, so
 * `.oxlintrc.json` naming the specifier as a configuration value is not
 * reported as a violation of the rule it declares.
 */
const IMPORT_PATTERNS: ReadonlyArray<{ form: BannedImport['form']; pattern: RegExp }> = [
  // Named, default, namespace, type-only, and re-export forms.
  {
    form: 'static',
    pattern: new RegExp(
      `(?<![\\w.])(?:import|export)\\s+(?:type\\s+)?[^;\\n]*?from\\s*${QUOTED_SPECIFIER}`,
      'g',
    ),
  },
  // Bare side-effect import.
  {
    form: 'static',
    pattern: new RegExp(`(?<![\\w.])import\\s*${QUOTED_SPECIFIER}`, 'g'),
  },
  // Dynamic import — the form `no-restricted-imports` cannot see at all.
  {
    form: 'dynamic',
    pattern: new RegExp(`(?<![\\w.])import\\s*\\(\\s*${QUOTED_SPECIFIER}\\s*\\)`, 'g'),
  },
  {
    form: 'require',
    pattern: new RegExp(`(?<![\\w.])require\\s*\\(\\s*${QUOTED_SPECIFIER}\\s*\\)`, 'g'),
  },
];

/**
 * Returns every `bun:test` import in `contents`, in line order.
 *
 * A file with no violations returns an empty array, which is what the caller
 * treats as passing — an empty result must never be conflated with "not
 * scanned", so the script counts scanned files separately.
 */
export function findBannedTestRunnerImports(contents: string): BannedImport[] {
  const found: BannedImport[] = [];

  for (const { form, pattern } of IMPORT_PATTERNS) {
    // `lastIndex` is shared state on a module-scope global regex; reset it so
    // one file's scan cannot start partway through because of the previous
    // file's match position.
    pattern.lastIndex = 0;

    for (const match of contents.matchAll(pattern)) {
      const index = match.index ?? 0;
      found.push({
        line: contents.slice(0, index).split('\n').length,
        text: match[0].trim(),
        form,
      });
    }
  }

  // Two patterns can match the same static import (the `from` form and the
  // bare form never overlap, but keeping this stable makes the report
  // deterministic regardless of pattern order).
  return found.sort(
    (first, second) => first.line - second.line || first.text.localeCompare(second.text),
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

/** Directory names never worth scanning — build output and dependencies. */
export const IGNORED_DIRECTORIES: readonly string[] = [
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.svelte-kit',
  '.turbo',
  '.git',
  '.vercel',
  'drizzle',
];

/** Whether a path segment list contains a directory this check never scans. */
export function isIgnoredPath(segments: readonly string[]): boolean {
  return segments.some((segment) => IGNORED_DIRECTORIES.includes(segment));
}

/** Whether a filename has an extension whose contents can hold an import. */
export function isScannableFile(fileName: string): boolean {
  return SCANNABLE_EXTENSIONS.some((extension) => fileName.endsWith(extension));
}
