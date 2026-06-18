import { describe, expect, it } from 'vitest';
import { exposeTokenForCredentialInjection, toOpaqueToken } from './tokens';

describe('opaque tokens', () => {
  it('accepts arbitrary non-empty token text without prefix or length assumptions', () => {
    const token = toOpaqueToken('short');

    expect(exposeTokenForCredentialInjection(token)).toBe('short');
  });

  it('keeps long installation tokens intact', () => {
    const tokenText = `ghs_APPID_JWT_${'x'.repeat(512)}`;
    const token = toOpaqueToken(tokenText);

    expect(exposeTokenForCredentialInjection(token)).toBe(tokenText);
  });

  it('rejects an empty token', () => {
    expect(() => toOpaqueToken('')).toThrow('Token must be a non-empty string.');
  });
});
