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
 * Every pattern is case-sensitive and whole-word (`\b...\b`) so it matches
 * only the standalone abbreviation, never a substring of a longer identifier
 * or word: `prNumber`, `prHref`, `pr-link`, `repositoryOwner`, `configurable`,
 * and `organization` all pass untouched. Lowercase `pr`/`repo` inside
 * identifiers (for example the `review-pr:` workflow-type string) also pass,
 * because the denylist requires the capitalized form for `PR` and does not
 * flag lowercase `pr` at all — this deliberately leaves engine identifiers
 * like `review-pr:<repositoryId>` alone, since those are not authored prose.
 */
const DENYLIST: RegExp[] = [/\bPRs?\b/, /\brepos?\b/, /\bconfigs?\b/, /\borgs?\b/];

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
 * (`{...}`) are stripped before matching: they hold identifiers and
 * expressions (loop variables like `repo`, member access like
 * `run.prNumber`), never authored prose, so leaving them in would flag
 * variable names instead of copy.
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
  const literals = [...source.matchAll(literalPattern)].map((match) =>
    match[0].replace(/\$\{[^}]*\}/g, ''),
  );
  const templateOnly = source.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  const textNodes = templateOnly.replace(/<[^>]+>/g, '\n').replace(/\{[^{}]*\}/g, '');
  return [...literals, textNodes];
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
      const prose = stripNonProse(readFileSync(file, 'utf-8'));
      const violations: string[] = [];

      for (const candidate of extractProseCandidates(prose)) {
        for (const pattern of DENYLIST) {
          const match = candidate.match(pattern);
          if (match) {
            violations.push(`"${match[0]}" in: ${candidate.trim().slice(0, 100)}`);
          }
        }
      }

      expect(violations).toEqual([]);
    });
  }
});
