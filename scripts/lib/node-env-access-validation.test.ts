import { describe, expect, it } from 'vitest';
import { findNodeEnvDotAccess } from './node-env-access-validation';

describe('findNodeEnvDotAccess', () => {
  it('flags dot-access to process.env.NODE_ENV with a file and line (AC4)', () => {
    const source = ['const first = 1;', "if (process.env.NODE_ENV === 'production') {}", ''].join(
      '\n',
    );
    const violations = findNodeEnvDotAccess(source, 'applications/web/src/example.ts');
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('applications/web/src/example.ts:2');
  });

  it('flags dot access split by an interstitial comment or whitespace', () => {
    expect(
      findNodeEnvDotAccess('const m = process.env /* runtime */ .NODE_ENV;', 'i.ts'),
    ).toHaveLength(1);
    expect(findNodeEnvDotAccess('const m = process . env . NODE_ENV;', 'w.ts')).toHaveLength(1);
  });

  it('flags a member chain split across lines', () => {
    const source = 'const mode = process\n  .env\n  .NODE_ENV;';
    expect(findNodeEnvDotAccess(source, 'multiline.ts')).toHaveLength(1);
  });

  it('does not flag the spelling inside a string literal', () => {
    const source = 'const message = "do not use process.env.NODE_ENV directly";';
    expect(findNodeEnvDotAccess(source, 'str.ts')).toEqual([]);
  });

  it('does not flag bracket access or SvelteKit env reads', () => {
    const source = [
      "const a = process.env['NODE_ENV'];",
      "const b = env.NODE_ENV === 'production';",
      'const c = environment.NODE_ENV;',
    ].join('\n');
    expect(findNodeEnvDotAccess(source, 'ok.ts')).toEqual([]);
  });

  it('does not flag the pattern inside line, inline, or multi-line block comments', () => {
    const source = [
      '// never use process.env.NODE_ENV here',
      'const a = 1; /* process.env.NODE_ENV */',
      '/*',
      ' process.env.NODE_ENV is banned',
      '*/',
      'const ok = env.NODE_ENV; // not process.env.NODE_ENV',
    ].join('\n');
    expect(findNodeEnvDotAccess(source, 'comments.ts')).toEqual([]);
  });

  it('still flags real code on a line that also has a trailing comment', () => {
    const source = 'const x = process.env.NODE_ENV; // oops';
    expect(findNodeEnvDotAccess(source, 'real.ts')).toHaveLength(1);
  });

  it('flags real code that follows a string literal containing //', () => {
    // A naive split on `//` would drop the real read after the URL string.
    expect(
      findNodeEnvDotAccess("const u = 'http://localhost'; const m = process.env.NODE_ENV;", 'a.ts'),
    ).toHaveLength(1);
    expect(
      findNodeEnvDotAccess('const u = "ws://x"; const m = process.env.NODE_ENV;', 'b.ts'),
    ).toHaveLength(1);
    expect(
      findNodeEnvDotAccess('const u = `http://x`; const m = process.env.NODE_ENV;', 'c.ts'),
    ).toHaveLength(1);
  });

  it('flags real code between string literals that contain block-comment markers', () => {
    // The `/*` and `*/` live inside strings; a regex block-comment strip would
    // blank the real read between them.
    const source = "const marker = '/*'; const mode = process.env.NODE_ENV; const end = '*/';";
    expect(findNodeEnvDotAccess(source, 'e.ts')).toHaveLength(1);
  });

  it('flags real code after a regex literal whose delimiters look like a comment', () => {
    // The regex ends in `\/\//`; a comment-only scanner treats the trailing `//`
    // as a line comment and blanks the real read.
    const source = 'const matcher = /https?:\\/\\//; const mode = process.env.NODE_ENV;';
    expect(findNodeEnvDotAccess(source, 'r.ts')).toHaveLength(1);
  });

  it('handles a regex character class containing a slash', () => {
    const source = 'const r = /[/]/; const mode = process.env.NODE_ENV;';
    expect(findNodeEnvDotAccess(source, 'cc.ts')).toHaveLength(1);
  });

  it('does not mistake division for a regex literal', () => {
    const source = 'const ratio = width / height; const mode = process.env.NODE_ENV;';
    expect(findNodeEnvDotAccess(source, 'div.ts')).toHaveLength(1);
  });

  it('handles an escaped quote inside a string without misreading the // that follows', () => {
    // The escaped quote does not close the string, so `//c` stays inside it and
    // the only real read is env.NODE_ENV (not process.env) — nothing to flag.
    expect(findNodeEnvDotAccess("const s = 'a\\'b//c'; const ok = env.NODE_ENV;", 'd.ts')).toEqual(
      [],
    );
  });

  it('flags dot access inside a template-literal interpolation', () => {
    // `${...}` is code, not string content — the mandatory gate must scan it.
    expect(findNodeEnvDotAccess('const mode = `${process.env.NODE_ENV}`;', 't.ts')).toHaveLength(1);
  });

  it('flags dot access inside an object literal within an interpolation', () => {
    // The inner `{ }` must not close the interpolation early (depth tracking).
    const source = 'const o = `${ { mode: process.env.NODE_ENV } }`;';
    expect(findNodeEnvDotAccess(source, 'obj.ts')).toHaveLength(1);
  });

  it('flags dot access inside a nested template interpolation', () => {
    const source = 'const n = `${`${process.env.NODE_ENV}`}`;';
    expect(findNodeEnvDotAccess(source, 'nested.ts')).toHaveLength(1);
  });

  it('does not flag the spelling in a template text span outside interpolation', () => {
    const source = 'const warn = `avoid process.env.NODE_ENV in code`;';
    expect(findNodeEnvDotAccess(source, 'text.ts')).toEqual([]);
  });

  it('treats a lone $ in a template (not followed by {) as text', () => {
    // A `$` that does not open an interpolation stays blanked string content, so
    // a later spelling in the same template is not a false positive.
    const source = 'const price = `$5 not process.env.NODE_ENV`;';
    expect(findNodeEnvDotAccess(source, 'dollar.ts')).toEqual([]);
  });

  it('recognizes a regex literal at the start of an interpolation', () => {
    // Entering `${`, the last significant token is `{`, so a leading `/` is a
    // regex (not division); its `//`-looking delimiters must not eat the read.
    const source = 'const m = `${/x/.test(y) ? process.env.NODE_ENV : "a"}`;';
    expect(findNodeEnvDotAccess(source, 'rgx.ts')).toHaveLength(1);
  });

  it('returns no violations for source without NODE_ENV', () => {
    expect(findNodeEnvDotAccess('export const x = 1;\n', 'clean.ts')).toEqual([]);
  });
});
