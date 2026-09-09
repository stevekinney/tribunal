/**
 * Detects dot-access reads of `process.env.NODE_ENV` in source (TRI-44 AC3).
 *
 * Some bundlers constant-fold `process.env.NODE_ENV` (dot form) to a string
 * literal, welding one environment into the built artifact and making
 * fail-closed runtime checks vacuous regardless of how the process is started.
 * Tribunal's web app reads `NODE_ENV` through its validated environment schema
 * and SvelteKit's `$env`, both of which stay runtime reads (verified against the
 * adapter-node build output), so `process.env.NODE_ENV` must never appear in
 * `applications/web/src`. Bracket access (`process.env['NODE_ENV']`) is not
 * constant-folded and is intentionally not flagged.
 */
const NODE_ENV_DOT_ACCESS = /process\.env\.NODE_ENV\b/;

/**
 * Blanks out comments while preserving string literals and newlines, in a
 * single pass that tracks string and comment state together.
 *
 * A regex or line-split approach cannot tell a real comment from a comment
 * marker inside a string (`'http://…'`, `'/*'`) or a quote inside a comment, so
 * either direction leaks: blanking too much hides a real `process.env.NODE_ENV`
 * after a string that happens to contain `//` or `/*` (a false negative in this
 * mandatory guard), and blanking too little trips on the pattern named in a
 * comment. Comments become spaces (newlines kept) so reported line numbers stay
 * accurate; string contents pass through unchanged.
 */
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

function blankComments(source: string): string {
  type State = 'code' | 'line' | 'block' | 'single' | 'double' | 'template' | 'regex';
  let state: State = 'code';
  let result = '';
  // Last non-whitespace character emitted in code state, for the regex/division
  // decision; and whether the regex scanner is inside a `[...]` character class,
  // where `/` is literal and does not close the literal.
  let lastSignificant: string | undefined;
  let inCharacterClass = false;
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
      // Inside a string literal: pass characters through; an escape consumes the
      // next character; the matching quote returns to code.
      result += character;
      if (character === '\\') {
        result += next ?? '';
        index += 1;
      } else if (
        (state === 'single' && character === "'") ||
        (state === 'double' && character === '"') ||
        (state === 'template' && character === '`')
      ) {
        state = 'code';
      }
    }
  }
  return result;
}

export function findNodeEnvDotAccess(source: string, filePath: string): string[] {
  const violations: string[] = [];
  blankComments(source)
    .split('\n')
    .forEach((line, index) => {
      if (NODE_ENV_DOT_ACCESS.test(line)) {
        violations.push(
          `${filePath}:${index + 1}: process.env.NODE_ENV dot-access is banned — a bundler can fold it to a literal and make runtime checks vacuous. Read NODE_ENV via the validated environment schema, or process.env['NODE_ENV'] bracket form.`,
        );
      }
    });
  return violations;
}
