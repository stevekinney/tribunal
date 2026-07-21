import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from './load-env';

describe('loadEnv', () => {
  let directory: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'load-env-test-'));
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) delete process.env[key];
    }
    Object.assign(process.env, originalEnv);
  });

  it('reports not found when there is no .env file', () => {
    const result = loadEnv(directory);
    expect(result).toEqual({ loaded: [], found: false });
  });

  it('parses quoted values, comments, and blank lines', () => {
    writeFileSync(
      join(directory, '.env'),
      [
        '# a comment',
        '',
        'PLAIN=value',
        'DOUBLE_QUOTED="quoted value"',
        "SINGLE_QUOTED='another value'",
        'no-equals-sign-line',
        '',
      ].join('\n'),
    );

    delete process.env['PLAIN'];
    delete process.env['DOUBLE_QUOTED'];
    delete process.env['SINGLE_QUOTED'];

    const result = loadEnv(directory);

    expect(result.found).toBe(true);
    expect(result.loaded.sort()).toEqual(['DOUBLE_QUOTED', 'PLAIN', 'SINGLE_QUOTED']);
    expect(process.env['PLAIN']).toBe('value');
    expect(process.env['DOUBLE_QUOTED']).toBe('quoted value');
    expect(process.env['SINGLE_QUOTED']).toBe('another value');
  });

  it('does not override an existing environment variable', () => {
    writeFileSync(join(directory, '.env'), 'EXISTING=from-file\n');
    process.env['EXISTING'] = 'from-shell';

    const result = loadEnv(directory);

    expect(result.loaded).not.toContain('EXISTING');
    expect(process.env['EXISTING']).toBe('from-shell');
  });

  it('defaults to process.cwd() when no directory is provided', () => {
    const result = loadEnv();
    expect(typeof result.found).toBe('boolean');
  });
});
