import { describe, expect, it, vi } from 'vitest';

import { requiredCommands, runReviewerImageChecks } from './verify-image-checks.mjs';

function createOutput() {
  return {
    stdout: { write: vi.fn() },
    stderr: { write: vi.fn() },
  };
}

function createSuccessfulImport(packageName) {
  if (packageName === '@anthropic-ai/claude-agent-sdk') {
    return Promise.resolve({ query: () => undefined });
  }
  if (packageName === '@tribunal/agents') {
    return Promise.resolve({
      READ_ONLY_AGENT_TOOLS: [],
      enforceReadOnlyToolUse: () => undefined,
    });
  }
  throw new Error(`Unexpected package: ${packageName}`);
}

describe('runReviewerImageChecks', () => {
  it('passes when commands, runner files, and runtime package shapes are present', async () => {
    const output = createOutput();

    await expect(
      runReviewerImageChecks({
        commandRunner: vi.fn(() => ({ status: 0 })),
        pathExists: vi.fn(() => true),
        importModule: createSuccessfulImport,
        ...output,
      }),
    ).resolves.toBe(0);

    expect(output.stdout.write).toHaveBeenCalledWith('Reviewer image self-check passed.\n');
    expect(output.stderr.write).not.toHaveBeenCalled();
  });

  it('reports every missing required command before package imports run', async () => {
    const output = createOutput();
    const importModule = vi.fn(createSuccessfulImport);

    await expect(
      runReviewerImageChecks({
        commandRunner: vi.fn((command) => ({
          status: command === requiredCommands[0] || command === requiredCommands[2] ? 1 : 0,
        })),
        pathExists: vi.fn(() => true),
        importModule,
        ...output,
      }),
    ).resolves.toBe(1);

    expect(output.stderr.write).toHaveBeenCalledWith(
      'Reviewer image is missing required commands: git, bun\n',
    );
    expect(importModule).not.toHaveBeenCalled();
  });

  it('reports an unreadable runner directory', async () => {
    const output = createOutput();

    await expect(
      runReviewerImageChecks({
        commandRunner: vi.fn(() => ({ status: 0 })),
        pathExists: vi.fn(() => false),
        importModule: createSuccessfulImport,
        ...output,
      }),
    ).resolves.toBe(1);

    expect(output.stderr.write).toHaveBeenCalledWith(
      'Reviewer image runner directory is not readable.\n',
    );
  });

  it('reports runtime package import failures', async () => {
    const output = createOutput();

    await expect(
      runReviewerImageChecks({
        commandRunner: vi.fn(() => ({ status: 0 })),
        pathExists: vi.fn(() => true),
        importModule: vi.fn((packageName) => {
          if (packageName === '@anthropic-ai/claude-agent-sdk') {
            throw new Error('module not found');
          }
          return createSuccessfulImport(packageName);
        }),
        ...output,
      }),
    ).resolves.toBe(1);

    expect(output.stderr.write).toHaveBeenCalledWith(
      'Reviewer image cannot import @anthropic-ai/claude-agent-sdk: module not found\n',
    );
  });

  it('reports invalid runtime package shapes', async () => {
    const output = createOutput();

    await expect(
      runReviewerImageChecks({
        commandRunner: vi.fn(() => ({ status: 0 })),
        pathExists: vi.fn(() => true),
        importModule: vi.fn((packageName) => {
          if (packageName === '@tribunal/agents') {
            return Promise.resolve({ READ_ONLY_AGENT_TOOLS: [] });
          }
          return createSuccessfulImport(packageName);
        }),
        ...output,
      }),
    ).resolves.toBe(1);

    expect(output.stderr.write).toHaveBeenCalledWith(
      'Reviewer image runtime package failed shape check: @tribunal/agents\n',
    );
  });

  it('uses the default runtime importer when no importer is injected', async () => {
    const output = createOutput();

    await expect(
      runReviewerImageChecks({
        commandRunner: vi.fn(() => ({ status: 0 })),
        pathExists: vi.fn(() => true),
        ...output,
      }),
    ).resolves.toBe(0);

    expect(output.stdout.write).toHaveBeenCalledWith('Reviewer image self-check passed.\n');
  });
});
