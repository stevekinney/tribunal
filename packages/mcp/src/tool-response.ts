/**
 * SEC-004: bound generated tool result content the same way inbound
 * requests are bounded. Every tool response in this codebase is built
 * through one of these three functions, so this is the single place a
 * cap on result size needs to live — no per-tool changes required, and no
 * new tool can accidentally skip it.
 *
 * A result that exceeds the cap is replaced with a stable, `isError: true`
 * response rather than silently truncated: truncating a JSON string mid-way
 * would hand the caller invalid JSON, which is worse than a clear failure.
 */
const maxToolResultBytes = 256 * 1024;

const utf8Encoder = new TextEncoder();

/**
 * The cap is on the UTF-8 bytes that go on the wire, not on `String.length`,
 * which counts UTF-16 code units. The two diverge badly for non-ASCII output:
 * 250,000 CJK characters satisfy a character-based check while encoding to
 * roughly 750 KB, so a character cap silently permits nearly three times the
 * advertised limit.
 *
 * The multiplication is a fast path, not an approximation of the answer. UTF-8
 * uses at most three bytes per UTF-16 code unit (a surrogate pair is two units
 * and four bytes, so two bytes per unit), so anything under a third of the cap
 * cannot possibly exceed it and never needs encoding. Only the remainder pays
 * for an exact measurement.
 */
function utf8ByteLength(text: string): number {
  return utf8Encoder.encode(text).length;
}

function boundedTextContent(text: string): { content: [{ type: 'text'; text: string }] } {
  if (text.length * 3 > maxToolResultBytes) {
    const byteLength = utf8ByteLength(text);
    if (byteLength > maxToolResultBytes) {
      return {
        content: [
          {
            type: 'text',
            text: `Result omitted: exceeded the ${maxToolResultBytes}-byte tool result limit (was ${byteLength} bytes).`,
          },
        ],
      };
    }
  }
  return { content: [{ type: 'text', text }] };
}

export function createToolTextResponse(text: string) {
  const bounded = boundedTextContent(text);
  if (bounded.content[0].text !== text) {
    return { ...bounded, isError: true };
  }
  return bounded;
}

export function createToolJsonResponse(data: unknown) {
  // `JSON.stringify` returns `undefined` (not the string `"undefined"`) for
  // `undefined`, symbols, and functions; normalize to `"null"` so this
  // always has a string to bound and callers always get valid JSON text.
  const serialized = JSON.stringify(data) ?? 'null';
  const bounded = boundedTextContent(serialized);
  if (bounded.content[0].text !== serialized) {
    return { ...bounded, isError: true };
  }
  return bounded;
}

export function createToolErrorResponse(message: string) {
  const bounded = boundedTextContent(message);
  return {
    ...bounded,
    isError: true,
  };
}

/**
 * The response shape for a tool that declares an `outputSchema`.
 * `structuredContent` carries the data a client validates against that
 * schema; `summary` is a separate, intentional human-readable text
 * ("text content only for an intentional human-readable summary") rather
 * than a second copy of the same JSON as text.
 *
 * Both the summary and the structured payload go through the same size
 * bound as every other tool response.
 */
export function createToolStructuredResponse<T>(data: T, summary: string) {
  const boundedSummary = boundedTextContent(summary);
  if (boundedSummary.content[0].text !== summary) {
    return { ...boundedSummary, isError: true };
  }

  const serialized = JSON.stringify(data) ?? 'null';
  if (serialized.length * 3 > maxToolResultBytes) {
    const serializedByteLength = utf8ByteLength(serialized);
    if (serializedByteLength > maxToolResultBytes) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Result omitted: exceeded the ${maxToolResultBytes}-byte tool result limit (was ${serializedByteLength} bytes).`,
          },
        ],
        isError: true,
      };
    }
  }

  return { ...boundedSummary, structuredContent: data };
}
