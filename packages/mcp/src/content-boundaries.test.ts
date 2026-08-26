import { describe, expect, it } from 'vitest';
import instructions from './instructions.js';

/**
 * Guards against a placeholder-instructions regression ("Customize these
 * instructions to describe your server's purpose...") and enforces that
 * the first 512 characters must be meaningful without later context --
 * some MCP clients only surface that much of a server's instructions in
 * some contexts, so the opening has to stand on its own.
 */

const firstFiveHundredTwelveCharacters = instructions.slice(0, 512);

describe('server instructions', () => {
  it('never contains generic placeholder phrasing', () => {
    expect(instructions.toLowerCase()).not.toContain('customize these instructions');
    expect(instructions.toLowerCase()).not.toContain('todo');
    expect(instructions.toLowerCase()).not.toContain('lorem ipsum');
  });

  it('the first 512 characters describe the server purpose, capability families, and authentication', () => {
    const opening = firstFiveHundredTwelveCharacters.toLowerCase();
    expect(opening).toContain('model context protocol');
    expect(
      opening.includes('tool') || opening.includes('resource') || opening.includes('prompt'),
    ).toBe(true);
    expect(opening).toContain('oauth');
    expect(opening).toContain('own account');
  });

  it('the opening paragraph is a complete, self-contained unit that fits inside the 512-character budget', () => {
    const openingParagraph = instructions.split('\n\n')[0]!;
    expect(openingParagraph.length).toBeLessThanOrEqual(512);
    // Ends on a real sentence boundary, not truncated mid-word -- a client
    // that only surfaces the first 512 characters still gets a
    // grammatically complete opening.
    expect(openingParagraph.trimEnd().endsWith('.')).toBe(true);
  });

  it('never claims a fixed capability set, since this package ships with none built in', () => {
    // This package is the reusable engine, not a server with any default
    // tool/resource/prompt of its own -- the instructions must not name a
    // specific operation that does not exist.
    expect(instructions).not.toContain('get_user_profile');
    expect(instructions).not.toContain('list_audit_events');
    expect(instructions).not.toContain('summarize');
  });
});
