import { describe, expect, it } from 'vitest';
import { readToolResultText } from './tool-result-text';

describe('readToolResultText', () => {
  it('reads a text result', () => {
    expect.assertions(1);

    expect(readToolResultText({ content: [{ type: 'text', text: 'A summary.' }] })).toBe(
      'A summary.',
    );
  });

  it('skips content that is not text rather than throwing', () => {
    expect.assertions(1);

    expect(
      readToolResultText({
        content: [
          { type: 'image', data: 'AAAA', mimeType: 'image/png' },
          { type: 'text', text: 'A summary.' },
        ],
      }),
    ).toBe('A summary.');
  });
});
