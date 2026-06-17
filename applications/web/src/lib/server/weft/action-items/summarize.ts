/**
 * Deterministic review comment summarization.
 *
 * Strips markdown prefixes, takes the first non-empty line, truncates at 120 characters.
 * No LLM calls — zero cost, fast, predictable. Used in place of LLM-based
 * rewriting (depict used Haiku/homogenaize; Tribunal drops that dependency).
 */

// ============================================================================
// CONSTANTS
// ============================================================================

/** Leading markdown prefixes to strip from the first line. */
const MARKDOWN_PREFIX_REGEX = /^(?:[>#*-]\s*)+/;

// ============================================================================
// SUMMARY
// ============================================================================

/**
 * Deterministic summary: strip markdown prefixes, take the first non-empty
 * line, truncate at 120 characters.
 *
 * Falls back to a generic label when the body is empty or entirely whitespace.
 */
export function deterministicSummary(body: string): string {
  const lines = body.split('\n');
  let firstLine = '';

  for (const line of lines) {
    const stripped = line.trim().replace(MARKDOWN_PREFIX_REGEX, '').trim();
    if (stripped) {
      firstLine = stripped;
      break;
    }
  }

  if (!firstLine) return 'Address review feedback';

  if (firstLine.length <= 120) return firstLine;
  return firstLine.slice(0, 117) + '...';
}
