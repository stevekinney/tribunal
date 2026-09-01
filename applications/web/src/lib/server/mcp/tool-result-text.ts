import type { CallToolResult } from '@modelcontextprotocol/server';

/**
 * Reads the human-readable text a tool result carries.
 *
 * A `CallToolResult`'s content entries are a union — text, image, audio, or an
 * embedded resource — so reaching for `.text` does not type-check, and every
 * caller that wants the summary would otherwise narrow it by hand. Tribunal's
 * tools only ever emit text, but the type is the SDK's and will not narrow on
 * that fact.
 *
 * Shared rather than repeated per call site because the verification issues
 * downstream of the registry each assert on tool result text too.
 */
export function readToolResultText(result: Pick<CallToolResult, 'content'>): string {
  return result.content
    .map((entry) => (entry.type === 'text' ? entry.text : ''))
    .join('')
    .trim();
}
