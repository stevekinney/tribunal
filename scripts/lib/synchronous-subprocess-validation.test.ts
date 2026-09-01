import { describe, expect, it } from 'vitest';
import { findUnboundedSynchronousSubprocessCalls } from './synchronous-subprocess-validation';

describe('findUnboundedSynchronousSubprocessCalls', () => {
  it('rejects synchronous subprocess calls without a timeout', () => {
    expect(
      findUnboundedSynchronousSubprocessCalls(
        "import { spawnSync } from 'node:child_process';\nspawnSync('tool', [], { stdio: 'inherit' });",
        'example.ts',
      ),
    ).toEqual([
      'example.ts:2 spawnSync must pass a positive literal timeout and SIGKILL killSignal.',
    ]);
  });

  it('accepts synchronous subprocess calls with a timeout', () => {
    expect(
      findUnboundedSynchronousSubprocessCalls(
        "import { execFileSync } from 'node:child_process';\nexecFileSync('tool', [], { timeout: 1_000, killSignal: 'SIGKILL' });",
        'example.ts',
      ),
    ).toEqual([]);
  });

  it('rejects execSync without a timeout', () => {
    expect(
      findUnboundedSynchronousSubprocessCalls(
        "import { execSync } from 'node:child_process';\nexecSync('tool');",
        'example.ts',
      ),
    ).toEqual([
      'example.ts:2 execSync must pass a positive literal timeout and SIGKILL killSignal.',
    ]);
  });

  it('parses TypeScript JSX sources', () => {
    expect(
      findUnboundedSynchronousSubprocessCalls(
        "import { execSync } from 'node:child_process';\nconst view = <div />;\nexecSync('tool');",
        'example.tsx',
      ),
    ).toEqual([
      'example.tsx:3 execSync must pass a positive literal timeout and SIGKILL killSignal.',
    ]);
  });

  it('follows an injected runner whose default is a synchronous subprocess', () => {
    expect(
      findUnboundedSynchronousSubprocessCalls(
        "import { spawnSync } from 'node:child_process';\nfunction run(commandRunner = spawnSync) { commandRunner('tool', [], { stdio: 'ignore' }); }",
        'example.ts',
      ),
    ).toEqual([
      'example.ts:2 spawnSync must pass a positive literal timeout and SIGKILL killSignal.',
    ]);
  });

  it('validates member calls and ignores unrelated call expressions', () => {
    expect(
      findUnboundedSynchronousSubprocessCalls(
        "Bun.spawnSync({ cmd: ['tool'] });\nBun.spawn({ cmd: ['tool'] });\n(factory())();",
        'example.ts',
      ),
    ).toEqual([
      'example.ts:1 spawnSync must pass a positive literal timeout and SIGKILL killSignal.',
    ]);
  });

  it('uses Node argument positions for namespace member calls', () => {
    expect(
      findUnboundedSynchronousSubprocessCalls(
        "import * as childProcess from 'node:child_process';\nchildProcess.spawnSync('tool', [], { timeout: 1_000, killSignal: 'SIGKILL' });",
        'example.ts',
      ),
    ).toEqual([]);
  });

  it('uses the second argument for execSync options', () => {
    expect(
      findUnboundedSynchronousSubprocessCalls(
        "import { execSync } from 'node:child_process';\nexecSync('tool', { timeout: 1_000, killSignal: 'SIGKILL' });",
        'example.ts',
      ),
    ).toEqual([]);
  });

  it('rejects a zero timeout or an ignorable kill signal', () => {
    expect(
      findUnboundedSynchronousSubprocessCalls(
        "import { spawnSync } from 'node:child_process';\nspawnSync('tool', [], { timeout: 0, killSignal: 'SIGTERM' });",
        'example.ts',
      ),
    ).toEqual([
      'example.ts:2 spawnSync must pass a positive literal timeout and SIGKILL killSignal.',
    ]);
  });

  it('tracks CommonJS destructuring and aliases', () => {
    expect(
      findUnboundedSynchronousSubprocessCalls(
        "const { execSync: run } = require('node:child_process');\nrun('tool');",
        'example.cjs',
      ),
    ).toEqual([
      'example.cjs:2 execSync must pass a positive literal timeout and SIGKILL killSignal.',
    ]);
  });

  it('recognizes the unprefixed child_process module', () => {
    expect(
      findUnboundedSynchronousSubprocessCalls(
        "import { execSync } from 'child_process';\nexecSync('tool');",
        'example.ts',
      ),
    ).toEqual([
      'example.ts:2 execSync must pass a positive literal timeout and SIGKILL killSignal.',
    ]);
  });

  it('accepts options as the second execFileSync argument', () => {
    expect(
      findUnboundedSynchronousSubprocessCalls(
        "import { execFileSync } from 'node:child_process';\nexecFileSync('tool', { timeout: 1_000, killSignal: 'SIGKILL' });",
        'example.ts',
      ),
    ).toEqual([]);
  });

  it('follows an injected runner in a destructured parameter', () => {
    expect(
      findUnboundedSynchronousSubprocessCalls(
        "import { spawnSync } from 'node:child_process';\nfunction run({ commandRunner = spawnSync } = {}) { commandRunner('tool'); }",
        'example.ts',
      ),
    ).toEqual([
      'example.ts:2 spawnSync must pass a positive literal timeout and SIGKILL killSignal.',
    ]);
  });

  it('only validates member calls on known subprocess namespaces', () => {
    expect(
      findUnboundedSynchronousSubprocessCalls(
        "const childProcess = require('child_process');\ncompiler.spawnSync('tool');\nchildProcess.execFileSync('tool');",
        'example.cjs',
      ),
    ).toEqual([
      'example.cjs:3 execFileSync must pass a positive literal timeout and SIGKILL killSignal.',
    ]);
  });
});
