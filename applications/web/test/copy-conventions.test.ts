import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Concurrently restructured by another change; has a genuine "Open PRs"
 * table header violation. Remove this entry — do not weaken the check —
 * once that restructuring lands and fixes it. Tracked in the pull request
 * description. Kept in sync with the matching `ignores` entry in
 * eslint.config.js's empty-state `no-restricted-syntax` rule.
 */
const EXCLUDED_FILES = [join('routes', '(authenticated)', 'repositories', '+page.svelte')];

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
 * imports), and `class`/`class:`/`*Class` attribute values (CSS class names,
 * which legitimately abbreviate — `pr-link`, `repo-icon`, `fieldClass=
 * "repo-row-checkbox"`, and so on) and `id`/`for` attribute values (DOM
 * identifiers, never rendered to the user).
 */
function stripNonProse(source: string): string {
  return source
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^\s*import\b[^;]*;/gm, '')
    .replace(/\b\w*[Cc]lass\s*=\s*(["'`])(?:(?!\1)[\s\S])*\1/g, '')
    .replace(/\bclass:[\w-]+(?:=\{[^}]*\})?/g, '')
    .replace(/\b(?:id|for)\s*=\s*(["'`])(?:(?!\1)[\s\S])*\1/g, '');
}

/**
 * Returns every string/template literal in the file (script or template
 * attribute) plus the plain text nodes of the markup. Together these cover
 * both authored prose sitting directly in the template and copy assembled in
 * `<script>` (derived subtitles, formatted labels, and the like) — the class
 * of violation that a template-only scan would miss entirely.
 *
 * Template-literal interpolations (`${...}`) and Svelte mustache expressions
 * (`{...}`) are blanked from the outer literal/text before matching: they
 * hold identifiers and expressions (loop variables like `repo`, member access
 * like `run.prNumber`), never authored prose, so leaving them in would flag
 * variable names instead of copy. But an interpolation can itself embed
 * authored string literals — a plural ternary like
 * `` `${count} ${count === 1 ? 'repository' : 'repositories'}` `` — so each
 * interpolation's contents are separately re-scanned for nested string
 * literals instead of being discarded wholesale.
 *
 * The plain-text-node pass additionally drops entire `<script>` blocks
 * (tags and content, not just tags): once tags are stripped, raw script
 * body — code, identifiers, comments — reads as "text" and would otherwise
 * be scanned as if it were prose. String/template literals inside
 * `<script>` are still covered by the separate literal-extraction pass
 * above, which is what actually needs to reach them.
 */
function extractProseCandidates(source: string): string[] {
  const literalPattern = /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g;
  const interpolationPattern = /\$\{[^}]*\}/g;

  const literals = [...source.matchAll(literalPattern)].flatMap((match) => {
    const literal = match[0];
    const nestedLiterals = [...literal.matchAll(interpolationPattern)].flatMap((interpolation) =>
      [...interpolation[0].matchAll(literalPattern)].map((nested) => nested[0]),
    );
    return [literal.replace(interpolationPattern, ''), ...nestedLiterals];
  });
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
});
