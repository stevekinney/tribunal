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
 * Returns the line with any trailing `//` line comment removed, ignoring `//`
 * that appears inside a string literal. A naive `split('//')` would truncate on
 * a URL such as `'http://…'` and drop real code after it — hiding a violation in
 * this mandatory guard — so string state is tracked before treating `//` as a
 * comment.
 */
function stripLineComment(line: string): string {
  let quote: "'" | '"' | '`' | null = null;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (quote) {
      if (character === '\\') index += 1;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === "'" || character === '"' || character === '`') {
      quote = character;
    } else if (character === '/' && line[index + 1] === '/') {
      return line.slice(0, index);
    }
  }
  return line;
}

export function findNodeEnvDotAccess(source: string, filePath: string): string[] {
  const violations: string[] = [];
  // Blank out block comments (inline and multi-line) while preserving newlines,
  // so a comment naming the pattern does not trip the guard and reported line
  // numbers stay accurate; then drop any trailing line comment (string-aware)
  // before matching.
  const withoutBlockComments = source.replace(/\/\*[\s\S]*?\*\//g, (match) =>
    match.replace(/[^\n]/g, ' '),
  );
  withoutBlockComments.split('\n').forEach((line, index) => {
    const code = stripLineComment(line);
    if (NODE_ENV_DOT_ACCESS.test(code)) {
      violations.push(
        `${filePath}:${index + 1}: process.env.NODE_ENV dot-access is banned — a bundler can fold it to a literal and make runtime checks vacuous. Read NODE_ENV via the validated environment schema, or process.env['NODE_ENV'] bracket form.`,
      );
    }
  });
  return violations;
}
