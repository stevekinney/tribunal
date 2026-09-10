import { describe, expect, it } from 'vitest';
import { isValidClientName } from '@lostgradient/mcp/oauth';

/**
 * TRI-40 AC7: a client display name must be rejected for every string in D1's
 * test-string list (`documentation/mcp-scopes.md`). The library's
 * `isValidClientName` is the enforcer — dynamic registration refines
 * `client_name` through it, and the consent seam falls back to a generic name
 * when it fails — so the consent screen never renders an attacker-controlled
 * name carrying control, bidirectional, or zero-width code points. This asserts
 * the enforcement covers the documented fixtures.
 *
 * The offending code points are built with `String.fromCodePoint(0x…)` rather
 * than pasted, so no real control/bidi/zero-width glyph is committed to source
 * (a trojan-source hazard, and the reason `documentation/mcp-scopes.md` itself
 * writes them as escapes).
 */
const cp = (hex: number) => String.fromCodePoint(hex);

const REJECTED: ReadonlyArray<readonly [string, string]> = [
  ['an embedded NUL byte', `My${cp(0x0)}App`],
  ['an embedded newline (C0 control)', 'My\nApp'],
  ['an embedded C1 control (NEL)', `My${cp(0x85)}App`],
  ['a right-to-left override', `My${cp(0x202e)}App`],
  ['isolate formatting (LRI / PDI)', `My${cp(0x2066)}App${cp(0x2069)}`],
  ['a bare left-to-right mark', `My${cp(0x200e)}App`],
  ['a zero-width space', `My${cp(0x200b)}App`],
  ['a leading byte-order mark', `${cp(0xfeff)}My App`],
];

const ACCEPTED: ReadonlyArray<readonly [string, string]> = [
  ['an ordinary ASCII name', 'My App'],
  // The donor's own fixture: four kanji then three katakana, no control/bidi/
  // zero-width code point present.
  ['an ordinary all-kanji/katakana name', '日本語アプリ'],
];

describe('isValidClientName (TRI-40 AC7 — D1 fixtures)', () => {
  it.each(REJECTED)('rejects a client name with %s', (_label, name) => {
    expect(isValidClientName(name)).toBe(false);
  });

  it.each(ACCEPTED)('accepts %s', (_label, name) => {
    expect(isValidClientName(name)).toBe(true);
  });
});
