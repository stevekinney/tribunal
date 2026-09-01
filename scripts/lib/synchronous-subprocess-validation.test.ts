import { describe, expect, it } from 'vitest';
import { findUnboundedSynchronousSubprocessCalls } from './synchronous-subprocess-validation';

describe('findUnboundedSynchronousSubprocessCalls', () => {
  it('rejects synchronous subprocess calls without a timeout', () => {
    expect(
      findUnboundedSynchronousSubprocessCalls(
        "import { spawnSync } from 'node:child_process';\nspawnSync('tool', [], { stdio: 'inherit' });",
        'example.ts',
      ),
    ).toEqual(['example.ts:2 spawnSync must pass an explicit timeout option.']);
  });

  it('accepts synchronous subprocess calls with a timeout', () => {
    expect(
      findUnboundedSynchronousSubprocessCalls(
        "import { execFileSync } from 'node:child_process';\nexecFileSync('tool', [], { timeout: 1_000 });",
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
    ).toEqual(['example.ts:2 execSync must pass an explicit timeout option.']);
  });

  it('parses TypeScript JSX sources', () => {
    expect(
      findUnboundedSynchronousSubprocessCalls(
        "import { execSync } from 'node:child_process';\nconst view = <div />;\nexecSync('tool');",
        'example.tsx',
      ),
    ).toEqual(['example.tsx:3 execSync must pass an explicit timeout option.']);
  });

  it('follows an injected runner whose default is a synchronous subprocess', () => {
    expect(
      findUnboundedSynchronousSubprocessCalls(
        "import { spawnSync } from 'node:child_process';\nfunction run(commandRunner = spawnSync) { commandRunner('tool', [], { stdio: 'ignore' }); }",
        'example.ts',
      ),
    ).toEqual(['example.ts:2 spawnSync must pass an explicit timeout option.']);
  });

  it('validates member calls and ignores unrelated call expressions', () => {
    expect(
      findUnboundedSynchronousSubprocessCalls(
        "Bun.spawnSync({ cmd: ['tool'] });\nBun.spawn({ cmd: ['tool'] });\n(factory())();",
        'example.ts',
      ),
    ).toEqual(['example.ts:1 spawnSync must pass an explicit timeout option.']);
  });
});
