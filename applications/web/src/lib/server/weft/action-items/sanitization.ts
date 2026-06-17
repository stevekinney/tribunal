/**
 * Sanitization and artifact detection for action item candidates.
 *
 * This module filters out machine-generated noise, bot artifacts, and malformed
 * content before action items reach the summarization or persistence layer. It does
 * NOT perform PII redaction or sensitive-content removal — callers must not rely
 * on this module to sanitize emails, tokens, or other user-provided data.
 *
 * Filtering categories:
 * - Version control payloads: [vc]: prefixed machine blobs
 * - Empty content: whitespace-only or too-short text
 * - Opaque blobs: JSON objects or arrays
 * - Bot noise: codecov reports, automated bot notifications identified by
 *   start-of-text bot name patterns or explicit [bot] tags
 * - CI status updates: build/test/coverage reports
 */

// ============================================================================
// TYPES
// ============================================================================

export type SanitizationMetadata = {
  /** Original length before normalization */
  originalLength?: number;
  /** Length after normalization */
  normalizedLength?: number;
  /** Source identifier for diagnostic purposes */
  source?: string;
  /** Actual length after normalization (set when filtered for too_short) */
  actualLength?: number;
};

export type SanitizationResult = {
  /**
   * Normalized text. Non-empty when content passes all filters (filtered=false),
   * or when the item is soft-filtered (too_short, ci_status_update) and the
   * normalized form is still available for callers that preserve such items.
   * Empty string only for hard filter reasons (version_control_payload,
   * empty_content, opaque_blob, bot_noise).
   */
  readonly sanitized: string;
  /** True if content was filtered out */
  readonly filtered: boolean;
  /** Reason for filtering (undefined if not filtered) */
  readonly reason?: FilterReason;
  /** Diagnostic metadata */
  readonly metadata: SanitizationMetadata;
};

export type FilterReason =
  | 'version_control_payload'
  | 'empty_content'
  | 'opaque_blob'
  | 'bot_noise'
  | 'too_short'
  | 'ci_status_update';

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Remove C0 (U+0000-U+001F) and C1 (U+007F-U+009F) control characters from a
 * string. Done with a code-point filter rather than a regex: a control-character
 * regex trips eslint's no-control-regex, and silencing that with a disable
 * directive then trips oxlint's unused-directive check under --max-warnings 0.
 * Filtering by char code sidesteps both linters cleanly.
 */
function stripControlCharacters(value: string): string {
  // Collect kept characters in an array and join once, rather than `result +=`
  // in a loop (which can be O(n²) on large PR-body / CI-blob inputs).
  const kept: string[] = [];
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    const isC0 = code <= 0x1f;
    const isC1 = code >= 0x7f && code <= 0x9f;
    if (!isC0 && !isC1) {
      kept.push(character);
    }
  }
  return kept.join('');
}

// ============================================================================
// SANITIZATION
// ============================================================================

/**
 * Sanitize and validate an action item candidate.
 *
 * Returns a SanitizationResult indicating whether the content should be
 * included (filtered=false) or excluded (filtered=true) from downstream
 * processing.
 *
 * @param raw - Raw candidate text from review comment, PR body, or CI output
 * @param source - Source identifier for diagnostic purposes
 * @returns Sanitization result with normalized text or filter reason
 */
export function sanitizeActionItemCandidate(raw: string, source: string): SanitizationResult {
  const metadata: SanitizationMetadata = {
    originalLength: raw.length,
    source,
  };

  // 1. Detect version control payloads: [vc]: case-insensitive
  if (/^\s*\[vc\]:/i.test(raw)) {
    return {
      sanitized: '',
      filtered: true,
      reason: 'version_control_payload',
      metadata,
    };
  }

  // 2. Detect empty or whitespace-only content
  const trimmed = raw.trim();
  if (!trimmed) {
    return {
      sanitized: '',
      filtered: true,
      reason: 'empty_content',
      metadata,
    };
  }

  // 3. Normalize whitespace and remove control characters early.
  // This ensures length checks happen on the final normalized form.
  const normalized = stripControlCharacters(trimmed.replace(/\s+/g, ' '));

  // 4. Detect opaque JSON blobs (check before length to avoid false positives)
  if (looksLikeJSON(normalized)) {
    return {
      sanitized: '',
      filtered: true,
      reason: 'opaque_blob',
      metadata,
    };
  }

  // 5. Check minimum length threshold (10 characters) on normalized content
  if (normalized.length < 10) {
    return {
      // Return normalized text so callers that preserve short items (e.g. the
      // healing pass) still receive the whitespace-cleaned form rather than
      // falling back to the raw, unnormalized input.
      sanitized: normalized,
      filtered: true,
      reason: 'too_short',
      metadata: { ...metadata, actualLength: normalized.length },
    };
  }

  // 6. Detect bot patterns (codecov, CI status, build reports)
  if (isBotNoise(normalized)) {
    return {
      sanitized: '',
      filtered: true,
      reason: 'bot_noise',
      metadata,
    };
  }

  // 7. Detect CI status updates
  if (isCIStatusUpdate(normalized)) {
    return {
      // Return normalized text so callers that preserve CI status items still
      // receive the whitespace-cleaned form rather than the raw input.
      sanitized: normalized,
      filtered: true,
      reason: 'ci_status_update',
      metadata,
    };
  }

  return {
    sanitized: normalized,
    filtered: false,
    metadata: {
      originalLength: raw.length,
      normalizedLength: normalized.length,
      source,
    },
  };
}

// ============================================================================
// DETECTION HELPERS
// ============================================================================

/**
 * Check if text looks like a JSON object or array.
 */
function looksLikeJSON(text: string): boolean {
  if (!/^\s*[{[]/.test(text) || !/[}\]]\s*$/.test(text)) {
    return false;
  }
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if text matches bot-generated patterns.
 *
 * Patterns that match a bot name (dependabot, renovate) are anchored to the
 * start of the text to avoid filtering legitimate human action items that
 * mention those names in passing (e.g. "Update the dependabot configuration").
 * Bot-generated messages produced by these tools consistently start with the
 * bot name or contain a structural tag like [bot].
 */
function isBotNoise(text: string): boolean {
  const botPatterns = [
    /^codecov\//i, // Codecov bot path prefix anchored to start-of-text
    /^(?:line\s+)?coverage[\s:].*\d+%/i, // Coverage reports (must start with "coverage" or "line coverage")
    /\[bot\]/i, // Generic bot tag (e.g. "dependabot[bot]", "renovate[bot]")
    /^dependabot(?:\s|[[\]:/]|$)/i, // Dependabot-generated content starting with "dependabot"
    /^renovate(?:\s|[[\]:/]|$)/i, // Renovate-generated content starting with "renovate"
  ];

  return botPatterns.some((pattern) => pattern.test(text));
}

/**
 * Check if text is a CI status update.
 *
 * Patterns are anchored or tightly scoped to avoid matching human review
 * comments like "Test the scenario where authentication failed".
 */
function isCIStatusUpdate(text: string): boolean {
  const ciPatterns = [
    /^build\s+(?:succeeded|failed|passed)/i,
    /^(?:all\s+)?tests?\s+(?:suite\s+)?(?:passed|failed|succeeded)/i,
    /^(?:all\s+)?checks?\s+(?:passed|failed|succeeded)/i,
    /^deploy(?:ment)?\s+(?:succeeded|failed|completed)/i,
    /^\d+\s+(?:tests?|checks?|jobs?)\s+(?:passed|failed)/i,
  ];

  return ciPatterns.some((pattern) => pattern.test(text));
}
