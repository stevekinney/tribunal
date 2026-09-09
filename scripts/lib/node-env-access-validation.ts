/**
 * Detects dot-access reads of `process.env.NODE_ENV` in source (TRI-44 AC3).
 *
 * Some bundlers constant-fold `process.env.NODE_ENV` (dot form) to a string
 * literal, welding one environment into the built artifact and making
 * fail-closed runtime checks vacuous regardless of how the process is started.
 * Tribunal's web app reads `NODE_ENV` through its validated environment schema
 * and SvelteKit's `$env`, both of which stay runtime reads (verified against the
 * adapter-node build output), so `process.env.NODE_ENV` must never appear in
 * the web server's shipped source. The caller scans `applications/web/src` plus
 * `applications/web/test`, because the production entrypoint imports test-support
 * modules (`$testing/end-to-end/handle`) into the server bundle, so that
 * directory also ships. Bracket access (`process.env['NODE_ENV']`) is not
 * constant-folded and is intentionally not flagged.
 *
 * The tokenizer scans template-literal interpolations as code, so a read inside
 * `${...}` (including nested templates) is caught; only the literal text spans
 * of a template are treated as string content.
 */
// Whitespace-tolerant between the member-access tokens, so an interstitial
// comment (blanked to spaces, e.g. `process.env /* x */ .NODE_ENV`) or dot
// access split by whitespace or newlines is still matched — all remain foldable
// dot access. `\s` spans newlines, and the scan runs over the whole source (not
// line by line) so a member chain broken across lines is caught. Bracket access
// (`process.env['NODE_ENV']`) has no `.NODE_ENV` and is intentionally not matched.
const NODE_ENV_DOT_ACCESS = /process\s*\.\s*env\s*\.\s*NODE_ENV\b/g;

/**
 * A `/` begins a regex literal (rather than division) when the previous
 * significant token sits in expression position — after an operator, an opening
 * bracket, or a separator, or at the start of input. This is the standard
 * lexer heuristic; it is not a full parser but it distinguishes the cases that
 * matter here (a divisor follows a value or `)`/`]`, a regex follows the rest).
 */
const REGEX_PRECEDING_PUNCTUATION = new Set([
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
  '<',
  '>',
  '~',
  '^',
  '\n',
]);

/**
 * Blanks out comments and string-literal contents in a single pass that tracks
 * string, comment, and regex state together, preserving newlines so line
 * numbers stay accurate.
 *
 * A regex or line-split approach cannot tell a real comment from a comment
 * marker inside a string (`'http://…'`, `'/*'`), a quote inside a comment, or a
 * `//` that closes a regex literal, so it leaks in one direction or the other.
 * Comments become spaces; string contents become spaces too (so the spelling
 * `process.env.NODE_ENV` inside a message is not a false positive) while the
 * quote delimiters and regex literals pass through as code.
 */
function blankCommentsAndStrings(source: string): string {
  type State = 'code' | 'line' | 'block' | 'single' | 'double' | 'template' | 'regex';
  let state: State = 'code';
  let result = '';
  // Last non-whitespace character emitted in code state, for the regex/division
  // decision; and whether the regex scanner is inside a `[...]` character class,
  // where `/` is literal and does not close the literal.
  let lastSignificant: string | undefined;
  let inCharacterClass = false;
  // Brace-depth stack for template interpolation. A `${` in a template opens a
  // code context (pushing depth 0); `{`/`}` inside it are counted so an object
  // literal does not close the interpolation early; the matching `}` at depth 0
  // pops back to template. The stack lets nested templates each carry their own
  // depth, so `${`${x}`}` tokenizes correctly.
  const templateBraceDepths: number[] = [];
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (state === 'code') {
      if (character === '/' && next === '/') {
        state = 'line';
        result += '  ';
        index += 1;
      } else if (character === '/' && next === '*') {
        state = 'block';
        result += '  ';
        index += 1;
      } else if (character === '/' && REGEX_PRECEDING_PUNCTUATION.has(lastSignificant ?? '\n')) {
        state = 'regex';
        inCharacterClass = false;
        result += character;
      } else if (character === "'" || character === '"' || character === '`') {
        state = character === "'" ? 'single' : character === '"' ? 'double' : 'template';
        result += character;
      } else if (character === '{') {
        if (templateBraceDepths.length > 0)
          templateBraceDepths[templateBraceDepths.length - 1] += 1;
        result += character;
        lastSignificant = character;
      } else if (character === '}' && templateBraceDepths.length > 0) {
        if (templateBraceDepths[templateBraceDepths.length - 1] === 0) {
          // Closes the interpolation: return to the enclosing template literal.
          templateBraceDepths.pop();
          state = 'template';
          result += character;
        } else {
          templateBraceDepths[templateBraceDepths.length - 1] -= 1;
          result += character;
          lastSignificant = character;
        }
      } else {
        result += character;
        if (!/\s/.test(character)) lastSignificant = character;
      }
    } else if (state === 'regex') {
      // Pass regex characters through so an embedded `//` or `/*` is not treated
      // as a comment; an escape consumes the next character; `[`/`]` toggle a
      // character class where `/` is literal; an unescaped `/` outside a class
      // ends the literal.
      result += character;
      if (character === '\\') {
        result += next ?? '';
        index += 1;
      } else if (character === '[') {
        inCharacterClass = true;
      } else if (character === ']') {
        inCharacterClass = false;
      } else if (character === '/' && !inCharacterClass) {
        state = 'code';
        lastSignificant = '/';
      }
    } else if (state === 'line') {
      if (character === '\n') {
        state = 'code';
        result += '\n';
      } else {
        result += ' ';
      }
    } else if (state === 'block') {
      if (character === '*' && next === '/') {
        state = 'code';
        result += '  ';
        index += 1;
      } else {
        result += character === '\n' ? '\n' : ' ';
      }
    } else {
      // Inside a string literal: blank the contents (so the spelling
      // `process.env.NODE_ENV` in a message is not a false positive) while
      // keeping newlines and the quote delimiters; an escape consumes and blanks
      // the next character; the matching quote returns to code.
      if (state === 'template' && character === '$' && next === '{') {
        // A `${` opens an interpolation: it is code, not string content, so a
        // read like `${process.env.NODE_ENV}` must be scanned. Emit `${`, open a
        // brace-depth entry, and switch to code with `{` as the last significant
        // token so a leading regex literal is recognized.
        result += '${';
        templateBraceDepths.push(0);
        state = 'code';
        lastSignificant = '{';
        index += 1;
      } else if (character === '\\') {
        result += '  ';
        index += 1;
      } else if (
        (state === 'single' && character === "'") ||
        (state === 'double' && character === '"') ||
        (state === 'template' && character === '`')
      ) {
        result += character;
        state = 'code';
      } else {
        result += character === '\n' ? '\n' : ' ';
      }
    }
  }
  return result;
}

export function findNodeEnvDotAccess(source: string, filePath: string): string[] {
  const scanned = blankCommentsAndStrings(source);
  const pattern = new RegExp(NODE_ENV_DOT_ACCESS.source, 'g');
  const violations: string[] = [];
  let match: RegExpExecArray | null;
  // Scan the whole source (not line by line) so a member chain split across
  // lines is caught; derive the line from the match offset.
  while ((match = pattern.exec(scanned)) !== null) {
    const line = scanned.slice(0, match.index).split('\n').length;
    violations.push(
      `${filePath}:${line}: process.env.NODE_ENV dot-access is banned — a bundler can fold it to a literal and make runtime checks vacuous. Read NODE_ENV via the validated environment schema, or process.env['NODE_ENV'] bracket form.`,
    );
  }
  return violations;
}
