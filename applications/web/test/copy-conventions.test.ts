import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Files temporarily excluded from the banned-abbreviation scan below,
 * pending a fix already tracked elsewhere. Empty by default — add an entry
 * only alongside a comment naming the tracking issue/pull request, and
 * remove it as soon as that work lands. Kept in sync with the matching
 * `ignores` entry in eslint.config.js's empty-state `no-restricted-syntax`
 * rule when both checks share an exclusion.
 */
const EXCLUDED_FILES: string[] = [];

/**
 * Enforces .claude/rules/conventions.md ("Prefer full words in names") for
 * user-facing copy in Svelte components: `repository` not `repo`, `pull
 * request` not `PR`, `configuration` not `config`, `organization` not `org`.
 *
 * `CI` is explicitly exempted (see .claude/rules/conventions.md) and is not
 * on the denylist.
 *
 * Every pattern is whole-word (`\b...\b`) so it matches only the standalone
 * abbreviation, never a substring of a longer identifier or word:
 * `prNumber`, `prHref`, `pr-link`, `repositoryOwner`, `configurable`, and
 * `organization` all pass untouched. `repo`/`config`/`org` are matched in
 * both lowercase and title case (`Repo`, `Config`, `Org`) since prose
 * capitalizes them at the start of a heading or sentence. `PR` stays
 * uppercase-only and lowercase `pr` is never flagged, so engine identifiers
 * like `review-pr:<repositoryId>` (not authored prose) still pass.
 */
const DENYLIST: RegExp[] = [/\bPRs?\b/, /\b[Rr]epos?\b/, /\b[Cc]onfigs?\b/, /\b[Oo]rgs?\b/];

const SRC_ROOT = join(import.meta.dirname, '..', 'src');

function findSvelteFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    if (statSync(fullPath).isDirectory()) {
      files.push(...findSvelteFiles(fullPath));
    } else if (entry.endsWith('.svelte')) {
      files.push(fullPath);
    }
  }
  return files;
}

/**
 * Strips content that is never user-facing prose: `<style>` blocks (CSS,
 * not copy), HTML comments, import statements (module specifiers and named
 * imports), `class`/`class:`/`*Class` attribute values (CSS class names,
 * which legitimately abbreviate — `pr-link`, `repo-icon`, `fieldClass=
 * "repo-row-checkbox"`, and so on), `id`/`for` attribute values (DOM
 * identifiers, never rendered to the user), and other attributes whose
 * value is a URL, protocol identifier, or DOM/data hook rather than
 * rendered text: `href`/`src`/`action`/`formaction` (URLs — a path segment
 * like `/orgs/acme` would otherwise false-positive), `rel`/`target`
 * (link-behavior enums), `name`/`type` (form-field/element enums), and
 * `data-*` (scripting hooks). Attributes that legitimately carry visible
 * text (`aria-label`, `alt`, `title`, `placeholder`, `value`, plain text
 * children) are deliberately left untouched.
 *
 * The attribute/class/id stripping only makes sense for markup attributes —
 * it has no way to tell `name="..."` (an HTML attribute) apart from
 * `const name = 'Repo settings';` (an ordinary assignment) using regex
 * alone, since both read as "word, optional whitespace, `=`, optional
 * whitespace, quote". Applying it inside `<script>` would corrupt a real
 * script-composed string like that into `const ;` before the literal
 * scanner (`collectLiterals`, below) ever reaches it, hiding real rendered
 * copy. `<script>` blocks are protected with a placeholder while the
 * attribute regexes run, then restored verbatim; the literal scanner sees
 * the untouched original.
 */
function stripNonProse(source: string): string {
  const withoutStyleAndComments = source
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^\s*import\b[^;]*;/gm, '');

  const placeholderPrefix = 'SCRIPT_PLACEHOLDER_';
  const scripts: string[] = [];
  const withPlaceholders = withoutStyleAndComments.replace(
    /<script\b[^>]*>[\s\S]*?<\/script>/gi,
    (block) => {
      scripts.push(block);
      return ` ${placeholderPrefix}${scripts.length - 1}_END `;
    },
  );

  const stripped = withPlaceholders
    .replace(/\b\w*[Cc]lass\s*=\s*(["'`])(?:(?!\1)[\s\S])*\1/g, '')
    .replace(/\bclass:[\w-]+(?:=\{[^}]*\})?/g, '')
    .replace(
      /\b(?:id|for|href|src|action|formaction|rel|target|name|type|data-[\w-]+)\s*=\s*(["'`])(?:(?!\1)[\s\S])*\1/g,
      '',
    );

  return stripped.replace(
    new RegExp(`${placeholderPrefix}(\\d+)_END`, 'g'),
    (_match, index) => scripts[Number(index)],
  );
}

/**
 * Characters and keywords after which a `/` can only start a regex literal,
 * never begin a division operator — used to tell the two apart when
 * scanning for string delimiters, so that quote characters inside a regex
 * body (`/['"]/`) are never mistaken for the start of a string literal.
 * Deliberately excludes `<`/`>`: in Svelte source those precede tag
 * boundaries (`</script>`, `<br />`) far more often than a comparison
 * operator would precede a regex literal, and misreading them as
 * regex-literal context would swallow real markup that follows.
 */
const REGEX_PRECEDING_CHARS = new Set([
  '(',
  ',',
  '=',
  ':',
  '[',
  '!',
  '&',
  '|',
  '?',
  '{',
  '}',
  ';',
  '+',
  '-',
  '*',
  '%',
  '^',
  '~',
  '\n',
]);
const REGEX_PRECEDING_KEYWORDS = new Set([
  'return',
  'typeof',
  'case',
  'in',
  'of',
  'instanceof',
  'new',
  'delete',
  'void',
  'throw',
  'yield',
  'await',
  'do',
  'else',
]);

/**
 * Returns whether `source[index]` (a `/`) plausibly opens a regex literal
 * rather than being a division operator, based on the previous significant
 * token — the standard "regex vs. divide" heuristic hand-rolled JS lexers
 * use, since telling the two apart in general requires a full parser.
 */
function isRegexLiteralStart(source: string, index: number): boolean {
  let previous = index - 1;
  while (previous >= 0 && /\s/.test(source[previous])) previous -= 1;

  if (previous < 0) return true;

  const previousChar = source[previous];
  if (REGEX_PRECEDING_CHARS.has(previousChar)) return true;

  if (/[A-Za-z0-9_$]/.test(previousChar)) {
    let wordStart = previous;
    while (wordStart >= 0 && /[A-Za-z0-9_$]/.test(source[wordStart])) wordStart -= 1;
    return REGEX_PRECEDING_KEYWORDS.has(source.slice(wordStart + 1, previous + 1));
  }

  return false;
}

/**
 * Returns the index just past a regex literal's closing `/` and any
 * trailing flags, given `source[start]` is its opening `/`. Tracks
 * character-class (`[...]`) state so a `/` inside `[...]` (like the one in
 * `/[/]/`) doesn't end the literal early.
 */
function findRegexLiteralEnd(source: string, start: number): number {
  let index = start + 1;
  let inCharacterClass = false;

  while (index < source.length) {
    const char = source[index];

    if (char === '\\') {
      index += 2;
      continue;
    }

    if (char === '\n') return index;

    if (char === '[') {
      inCharacterClass = true;
    } else if (char === ']') {
      inCharacterClass = false;
    } else if (char === '/' && !inCharacterClass) {
      index += 1;
      while (index < source.length && /[a-z]/i.test(source[index])) index += 1;
      return index;
    }

    index += 1;
  }

  return index;
}

/**
 * Returns the index just past the closing delimiter of a string or template
 * literal that starts at `source[start]` (a `"`, `'`, or `` ` ``).
 *
 * A plain quote just scans for the next unescaped matching quote. A
 * backtick is scanned char-by-char instead of with a single regex: a
 * `${...}` interpolation can itself contain nested template literals
 * (`` `${a ? `PR #${n}` : ''}` ``), and a regex that stops at the first
 * unescaped backtick would treat that nested literal's opening backtick as
 * the outer literal's close. `findInterpolationEnd` (below) walks past each
 * interpolation as a balanced unit so this only ever sees the true closing
 * backtick.
 */
function findLiteralEnd(source: string, start: number): number {
  const quote = source[start];
  let index = start + 1;

  while (index < source.length) {
    const char = source[index];

    if (char === '\\') {
      index += 2;
      continue;
    }

    if (char === quote) {
      return index + 1;
    }

    if (quote === '`' && char === '$' && source[index + 1] === '{') {
      index = findInterpolationEnd(source, index + 2);
      continue;
    }

    index += 1;
  }

  return index;
}

/**
 * Returns the index just past the `}` that closes a `${...}` interpolation
 * whose content starts at `source[start]` (right after its `${`). Tracks
 * brace depth so a nested object literal (`${ { a: 1 } }`) doesn't close it
 * early, defers to `findLiteralEnd` for any nested quote/backtick so that
 * literal's own braces and quotes are skipped rather than counted, and
 * defers to `findRegexLiteralEnd` for a regex literal for the same reason —
 * an interpolation can itself contain one (`` `${str.replace(/PR/g, x)}` ``).
 */
function findInterpolationEnd(source: string, start: number): number {
  let depth = 0;
  let index = start;

  while (index < source.length) {
    const char = source[index];

    if (char === '\\') {
      index += 2;
      continue;
    }

    if (char === '"' || char === "'" || char === '`') {
      index = findLiteralEnd(source, index);
      continue;
    }

    if (char === '/' && isRegexLiteralStart(source, index)) {
      index = findRegexLiteralEnd(source, index);
      continue;
    }

    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      if (depth === 0) return index + 1;
      depth -= 1;
    }

    index += 1;
  }

  return index;
}

/**
 * Finds every top-level (unnested) string/template literal in `source`.
 * Regex literals are recognized and skipped as opaque spans (not just
 * scanned character-by-character) so a quote character inside one, like the
 * `'` and `"` in `/['"]/`, is never mistaken for the start of a real string
 * — which would otherwise mispair with the next real quote later in the
 * file and swallow whatever string sits between them.
 */
function findTopLevelLiterals(source: string): string[] {
  const literals: string[] = [];
  let index = 0;

  while (index < source.length) {
    const char = source[index];

    if (char === '"' || char === "'" || char === '`') {
      const end = findLiteralEnd(source, index);
      literals.push(source.slice(index, end));
      index = end;
      continue;
    }

    if (char === '/' && isRegexLiteralStart(source, index)) {
      index = findRegexLiteralEnd(source, index);
      continue;
    }

    index += 1;
  }

  return literals;
}

/**
 * Splits a template literal's raw text (including its backticks) into its
 * non-interpolated text (`stripped`) and the raw expression text of each
 * `${...}` interpolation, so callers can recurse into the interpolations
 * separately instead of discarding them.
 */
function splitTemplateLiteral(literal: string): { stripped: string; interpolations: string[] } {
  const interpolations: string[] = [];
  let stripped = '';
  let index = 0;

  while (index < literal.length) {
    const char = literal[index];

    if (char === '\\') {
      stripped += literal.slice(index, index + 2);
      index += 2;
      continue;
    }

    if (char === '$' && literal[index + 1] === '{') {
      const contentStart = index + 2;
      const contentEnd = findInterpolationEnd(literal, contentStart) - 1;
      interpolations.push(literal.slice(contentStart, contentEnd));
      index = contentEnd + 1;
      continue;
    }

    stripped += char;
    index += 1;
  }

  return { stripped, interpolations };
}

/**
 * Recursively finds every string/template literal in `source`, including
 * ones nested inside a template literal's `${...}` interpolations —
 * arbitrarily deep, since an interpolation can itself contain another
 * template literal with its own interpolations. Each template literal is
 * returned with its interpolations blanked (bare identifiers and member
 * access inside them, like loop variables or `run.prNumber`, are never
 * authored prose), while each interpolation's own literals are returned
 * separately, un-blanked, so authored prose hiding inside them — a plural
 * ternary like `` `${count} ${count === 1 ? 'repository' : 'repositories'}` ``,
 * or a nested template like `` `${cond ? `PR #${n}` : ''}` `` — is still
 * checked.
 */
function collectLiterals(source: string): string[] {
  return findTopLevelLiterals(source).flatMap((literal) => {
    if (literal[0] !== '`') return [literal];

    const { stripped, interpolations } = splitTemplateLiteral(literal);
    return [stripped, ...interpolations.flatMap(collectLiterals)];
  });
}

/**
 * Returns every string/template literal in the file (script or template
 * attribute) plus the plain text nodes of the markup. Together these cover
 * both authored prose sitting directly in the template and copy assembled in
 * `<script>` (derived subtitles, formatted labels, and the like) — the class
 * of violation that a template-only scan would miss entirely.
 *
 * Svelte mustache expressions (`{...}`) are blanked from the text-node pass:
 * they hold identifiers and expressions (loop variables like `repo`, member
 * access like `run.prNumber`), never authored prose, so leaving them in
 * would flag variable names instead of copy.
 *
 * The plain-text-node pass additionally drops entire `<script>` blocks
 * (tags and content, not just tags): once tags are stripped, raw script
 * body — code, identifiers, comments — reads as "text" and would otherwise
 * be scanned as if it were prose. String/template literals inside
 * `<script>` are still covered by the separate literal-extraction pass
 * above, which is what actually needs to reach them.
 */
function extractProseCandidates(source: string): string[] {
  const literals = collectLiterals(source);
  const templateOnly = source.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  const textNodes = templateOnly.replace(/<[^>]+>/g, '\n').replace(/\{[^{}]*\}/g, '');
  return [...literals, textNodes];
}

/** Returns every banned-abbreviation match found in `source`'s user-facing copy. */
function findViolations(source: string): string[] {
  const prose = stripNonProse(source);
  const violations: string[] = [];

  for (const candidate of extractProseCandidates(prose)) {
    for (const pattern of DENYLIST) {
      const match = candidate.match(pattern);
      if (match) {
        violations.push(`"${match[0]}" in: ${candidate.trim().slice(0, 100)}`);
      }
    }
  }

  return violations;
}

describe('user-facing copy avoids banned abbreviations', () => {
  const files = findSvelteFiles(SRC_ROOT).filter(
    (file) => !EXCLUDED_FILES.includes(relative(SRC_ROOT, file)),
  );

  it('found .svelte files under src to scan', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  // If an excluded file is renamed, moved, or deleted, this fails loudly
  // instead of the exclusion silently widening to cover something else.
  it.each(EXCLUDED_FILES)('excluded file %s still exists on disk', (excludedFile) => {
    expect(existsSync(join(SRC_ROOT, excludedFile))).toBe(true);
  });

  for (const file of files) {
    const relativePath = relative(SRC_ROOT, file);

    it(`${relativePath} has no banned abbreviations in user-facing copy`, () => {
      expect(findViolations(readFileSync(file, 'utf-8'))).toEqual([]);
    });
  }
});

describe('user-facing copy avoids banned abbreviations: regression cases', () => {
  it('flags a banned abbreviation hidden inside a template interpolation', () => {
    const source = "<span>{`${count} ${count === 1 ? 'PR' : 'PRs'}`}</span>";
    expect(findViolations(source).length).toBeGreaterThan(0);
  });

  it('still allows the same interpolation shape when it uses full words', () => {
    const source = "<span>{`${count} ${count === 1 ? 'repository' : 'repositories'}`}</span>";
    expect(findViolations(source)).toEqual([]);
  });

  it('flags title-case abbreviations at the start of a heading or sentence', () => {
    expect(findViolations('<h2>Repo settings</h2>').length).toBeGreaterThan(0);
    expect(findViolations('<p>Config values are missing.</p>').length).toBeGreaterThan(0);
    expect(findViolations('<p>Org access required.</p>').length).toBeGreaterThan(0);
  });

  it('still allows the lowercase-only engine identifier exemption for pr', () => {
    expect(findViolations('<span>review-pr:{repositoryId}</span>')).toEqual([]);
  });

  it('flags a banned abbreviation hidden inside a nested template literal', () => {
    const source = "<span>{`${condition ? `PR #${number}` : ''}`}</span>";
    expect(findViolations(source).length).toBeGreaterThan(0);
  });

  it('still allows the same nested-template shape when it uses full words', () => {
    const source = "<span>{`${condition ? `Pull request #${number}` : ''}`}</span>";
    expect(findViolations(source)).toEqual([]);
  });

  it('does not flag banned words appearing inside a URL path segment', () => {
    const source = '<a href="https://github.com/orgs/acme/repos">Visit</a>';
    expect(findViolations(source)).toEqual([]);
  });

  it('still flags banned words in attributes that carry visible text', () => {
    expect(findViolations('<button aria-label="Repo settings">X</button>').length).toBeGreaterThan(
      0,
    );
    expect(findViolations('<input placeholder="Search repos" />').length).toBeGreaterThan(0);
  });

  it('does not let a script-assigned prose variable hide behind attribute stripping', () => {
    const source = "<script>\n  const name = 'Repo settings';\n</script>\n<h1>{name}</h1>";
    expect(findViolations(source).length).toBeGreaterThan(0);
  });

  it('still strips a real id/name/href attribute value from a script-adjacent element', () => {
    const source = '<input id="repo-1" name="repo-1" href="/repos/1" />';
    expect(findViolations(source)).toEqual([]);
  });

  it('does not let a regex literal with quote characters swallow later copy', () => {
    const source =
      "<script>\n  const quotePattern = /['\"]/;\n  const label = 'Open PR';\n</script>\n<span>{label}</span>";
    expect(findViolations(source).length).toBeGreaterThan(0);
  });

  it('still allows a division expression next to real copy', () => {
    const source =
      '<script>\n  const ratio = total / count;\n  const label = `Average: ${ratio}`;\n</script>\n<span>{label}</span>';
    expect(findViolations(source)).toEqual([]);
  });
});
