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

export function findNodeEnvDotAccess(source: string, filePath: string): string[] {
  const violations: string[] = [];
  source.split('\n').forEach((line, index) => {
    const trimmed = line.trimStart();
    // Skip whole-line comments (`//` and block-comment continuation `*`) so a
    // comment explaining the ban does not trip it; drop any trailing `//`
    // comment before matching the code portion.
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;
    const code = line.split('//')[0]!;
    if (NODE_ENV_DOT_ACCESS.test(code)) {
      violations.push(
        `${filePath}:${index + 1}: process.env.NODE_ENV dot-access is banned — a bundler can fold it to a literal and make runtime checks vacuous. Read NODE_ENV via the validated environment schema, or process.env['NODE_ENV'] bracket form.`,
      );
    }
  });
  return violations;
}
