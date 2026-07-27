import { describe, expect, it } from 'vitest';

import { parseJsonC, stripJsonComments } from './parse-jsonc.js';

describe('stripJsonComments', () => {
  it('removes a line comment, leaving the preceding indentation', () => {
    expect(stripJsonComments('{\n  // note\n  "a": 1\n}')).toBe('{\n  \n  "a": 1\n}');
  });

  it('removes a block comment', () => {
    expect(stripJsonComments('{/* note */"a": 1}')).toBe('{"a": 1}');
  });

  it('removes a multi-line block comment', () => {
    expect(stripJsonComments('{\n/*\n note\n*/\n"a": 1}')).toBe('{\n\n"a": 1}');
  });

  it('preserves a URL containing // inside a string', () => {
    const text = '{"$schema": "https://turbo.build/schema.json"}';

    expect(stripJsonComments(text)).toBe(text);
  });

  it('preserves what looks like a block comment inside a string', () => {
    const text = '{"glob": "src/*/**"}';

    expect(stripJsonComments(text)).toBe(text);
  });

  it('respects an escaped quote when tracking string boundaries', () => {
    const text = '{"quoted": "say \\"hi\\" // not a comment"}';

    expect(stripJsonComments(text)).toBe(text);
  });

  it('handles a trailing backslash at the end of input without overrunning', () => {
    expect(stripJsonComments('"abc\\')).toBe('"abc\\');
  });

  it('drops a line comment that runs to the end of input', () => {
    expect(stripJsonComments('{"a": 1}\n// trailing')).toBe('{"a": 1}\n');
  });

  it('drops an unterminated block comment', () => {
    expect(stripJsonComments('{"a": 1}/* unterminated')).toBe('{"a": 1}');
  });

  it('leaves comment-free JSON untouched', () => {
    const text = '{\n  "a": 1,\n  "b": [2, 3]\n}';

    expect(stripJsonComments(text)).toBe(text);
  });

  it('keeps a lone slash that starts no comment', () => {
    expect(stripJsonComments('{"a": 1}/')).toBe('{"a": 1}/');
  });
});

describe('parseJsonC', () => {
  it('parses configuration containing comments and a schema URL', () => {
    const text = `{
      "$schema": "https://turbo.build/schema.json",
      // package tasks only see their own package
      "tasks": { "build": { "outputs": ["dist/**"] } }
    }`;

    expect(parseJsonC(text)).toEqual({
      $schema: 'https://turbo.build/schema.json',
      tasks: { build: { outputs: ['dist/**'] } },
    });
  });

  it('parses ordinary JSON', () => {
    expect(parseJsonC<{ a: number }>('{"a": 1}')).toEqual({ a: 1 });
  });
});
