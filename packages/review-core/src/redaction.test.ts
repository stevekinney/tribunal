import { describe, expect, it } from 'vitest';
import { redactRuntimeRecord, redactRuntimeText, redactRuntimeValue } from './redaction';

describe('runtime redaction', () => {
  it('redacts known token and key patterns in text', () => {
    expect(
      redactRuntimeText(
        [
          'Bearer ghs_abcdefghijklmnopqrstuvwxyz',
          'sk-ant-secret',
          'github_pat_abcdefghijklmnopqrstuvwxyz',
          'AKIAABCDEFGHIJKLMNOP',
        ].join(' '),
      ),
    ).toBe('Bearer [REDACTED] [REDACTED] [REDACTED] [REDACTED]');
  });

  it('redacts sensitive keys and raw content recursively', () => {
    expect(
      redactRuntimeRecord({
        authorization: 'Bearer ghs_abcdefghijklmnopqrstuvwxyz',
        nested: {
          apiKey: 'sk-ant-secret',
          contents: 'const rawRepositoryFileContent = true;',
          values: ['safe', 'ghs_abcdefghijklmnopqrstuvwxyz'],
        },
      }),
    ).toEqual({
      authorization: '[REDACTED]',
      nested: {
        apiKey: '[REDACTED]',
        contents: '[REDACTED_CONTENT]',
        values: ['safe', '[REDACTED]'],
      },
    });
  });

  it('leaves non-sensitive primitives intact', () => {
    expect(redactRuntimeValue(null)).toBeNull();
    expect(redactRuntimeValue(42)).toBe(42);
    expect(redactRuntimeValue(false)).toBe(false);
    expect(redactRuntimeValue('plain text')).toBe('plain text');
  });
});
