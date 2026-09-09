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

  it('returns no violations for source without NODE_ENV', () => {
    expect(findNodeEnvDotAccess('export const x = 1;\n', 'clean.ts')).toEqual([]);
  });
});
