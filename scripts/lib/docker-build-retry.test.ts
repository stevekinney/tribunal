import { describe, expect, it, vi } from 'vitest';

import {
  isTransientDockerRegistryResolutionTimeout,
  readDockerBuildRetryEnvironmentConfiguration,
  runDockerBuildWithRetry,
  type DockerBuildRetryOptions,
} from './docker-build-retry';

const transientTimeoutOutput =
  'failed to solve: oven/bun:1.3.13: failed to resolve source metadata for docker.io/oven/bun:1.3.13: Head "https://registry-1.docker.io/v2/oven/bun/manifests/1.3.13": dial tcp 54.236.113.205:443: i/o timeout';

function createOptions(overrides: Partial<DockerBuildRetryOptions>): DockerBuildRetryOptions {
  return {
    command: ['docker', 'build', '-t', 'tribunal-reviewer:test', '.'],
    maximumAttempts: 3,
    retryDelayMs: 1,
    wallClockTimeoutMs: 1_000,
    spawnCommand: vi.fn().mockResolvedValue({ exitCode: 0, output: '', timedOut: false }),
    log: {
      error: vi.fn(),
      log: vi.fn(),
      warn: vi.fn(),
    },
    now: Date.now,
    sleep: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('isTransientDockerRegistryResolutionTimeout', () => {
  it('matches Docker Hub base-image metadata timeouts', () => {
    expect(isTransientDockerRegistryResolutionTimeout(transientTimeoutOutput)).toBe(true);
  });

  it('does not match non-transient Docker build failures', () => {
    expect(
      isTransientDockerRegistryResolutionTimeout(
        'failed to solve: process "/bin/sh -c bun install" did not complete successfully: exit code: 1',
      ),
    ).toBe(false);
  });
});

describe('runDockerBuildWithRetry', () => {
  it('uses default retry settings when optional limits are omitted', async () => {
    const spawnCommand = vi.fn().mockResolvedValue({ exitCode: 0, output: '', timedOut: false });
    const now = vi.fn().mockReturnValue(0);

    await runDockerBuildWithRetry({
      command: ['docker', 'build', '.'],
      spawnCommand,
      now,
      sleep: vi.fn().mockResolvedValue(undefined),
      log: {
        error: vi.fn(),
        log: vi.fn(),
        warn: vi.fn(),
      },
    });

    expect(spawnCommand).toHaveBeenCalledWith(['docker', 'build', '.'], { timeoutMs: 900_000 });
  });

  it('retries a transient registry timeout and returns after a later success', async () => {
    const spawnCommand = vi
      .fn()
      .mockResolvedValueOnce({ exitCode: 1, output: transientTimeoutOutput, timedOut: false })
      .mockResolvedValueOnce({ exitCode: 0, output: 'built image', timedOut: false });
    const sleep = vi.fn().mockResolvedValue(undefined);

    await runDockerBuildWithRetry(createOptions({ spawnCommand, sleep }));

    expect(spawnCommand).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledOnce();
  });

  it('retries immediately when the retry delay is zero', async () => {
    const spawnCommand = vi
      .fn()
      .mockResolvedValueOnce({ exitCode: 1, output: transientTimeoutOutput, timedOut: false })
      .mockResolvedValueOnce({ exitCode: 0, output: 'built image', timedOut: false });
    const sleep = vi.fn().mockResolvedValue(undefined);
    const now = vi
      .fn()
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(1)
      .mockReturnValueOnce(1)
      .mockReturnValueOnce(1);

    await runDockerBuildWithRetry(
      createOptions({ maximumAttempts: 2, retryDelayMs: 0, spawnCommand, sleep, now }),
    );

    expect(spawnCommand).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(0);
  });

  it('fails after capped transient timeout attempts', async () => {
    const spawnCommand = vi
      .fn()
      .mockResolvedValue({ exitCode: 1, output: transientTimeoutOutput, timedOut: false });

    await expect(
      runDockerBuildWithRetry(createOptions({ maximumAttempts: 2, spawnCommand })),
    ).rejects.toThrow('failed after 2 transient registry timeout attempt(s)');

    expect(spawnCommand).toHaveBeenCalledTimes(2);
  });

  it('does not retry non-transient Docker build failures', async () => {
    const spawnCommand = vi.fn().mockResolvedValue({
      exitCode: 1,
      output: 'failed to solve: process "/bin/sh -c bun install" did not complete successfully',
      timedOut: false,
    });

    await expect(runDockerBuildWithRetry(createOptions({ spawnCommand }))).rejects.toThrow(
      'Docker build failed with exit code 1',
    );

    expect(spawnCommand).toHaveBeenCalledOnce();
  });

  it('fails when the wall-clock retry budget expires', async () => {
    const spawnCommand = vi
      .fn()
      .mockResolvedValue({ exitCode: 1, output: transientTimeoutOutput, timedOut: false });
    const now = vi
      .fn()
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(1_000);

    await expect(
      runDockerBuildWithRetry(
        createOptions({
          maximumAttempts: 3,
          retryDelayMs: 10,
          wallClockTimeoutMs: 1_000,
          spawnCommand,
          now,
        }),
      ),
    ).rejects.toThrow('retry budget expired after transient registry timeout');

    expect(spawnCommand).toHaveBeenCalledOnce();
  });

  it('fails before an attempt when the wall-clock budget is already exhausted', async () => {
    const spawnCommand = vi.fn();
    const now = vi.fn().mockReturnValueOnce(1_000).mockReturnValueOnce(2_001);

    await expect(
      runDockerBuildWithRetry(
        createOptions({
          wallClockTimeoutMs: 1_000,
          spawnCommand,
          now,
        }),
      ),
    ).rejects.toThrow('retry budget expired before attempt 1');

    expect(spawnCommand).not.toHaveBeenCalled();
  });

  it('fails when a build attempt runs beyond the wall-clock budget', async () => {
    const spawnCommand = vi
      .fn()
      .mockResolvedValue({ exitCode: null, output: transientTimeoutOutput, timedOut: true });

    await expect(runDockerBuildWithRetry(createOptions({ spawnCommand }))).rejects.toThrow(
      'exceeded 1000ms wall-clock retry budget',
    );

    expect(spawnCommand).toHaveBeenCalledOnce();
  });

  it('validates retry options before spawning docker', async () => {
    const spawnCommand = vi.fn();

    await expect(
      runDockerBuildWithRetry(createOptions({ command: [], spawnCommand })),
    ).rejects.toThrow('must include at least one argument');
    await expect(
      runDockerBuildWithRetry(createOptions({ maximumAttempts: 0, spawnCommand })),
    ).rejects.toThrow('maximumAttempts must be a positive integer');
    await expect(
      runDockerBuildWithRetry(createOptions({ retryDelayMs: -1, spawnCommand })),
    ).rejects.toThrow('retryDelayMs must be a non-negative integer');
    await expect(
      runDockerBuildWithRetry(createOptions({ wallClockTimeoutMs: 0, spawnCommand })),
    ).rejects.toThrow('wallClockTimeoutMs must be a positive integer');

    expect(spawnCommand).not.toHaveBeenCalled();
  });
});

describe('readDockerBuildRetryEnvironmentConfiguration', () => {
  it('allows zero retry delay from the environment', () => {
    expect(
      readDockerBuildRetryEnvironmentConfiguration({
        DOCKER_BUILD_RETRY_DELAY_MS: '0',
      }).retryDelayMs,
    ).toBe(0);
  });

  it('rejects invalid environment values with matching bounds', () => {
    expect(() =>
      readDockerBuildRetryEnvironmentConfiguration({
        DOCKER_BUILD_MAXIMUM_ATTEMPTS: '0',
      }),
    ).toThrow('DOCKER_BUILD_MAXIMUM_ATTEMPTS must be a positive integer');
    expect(() =>
      readDockerBuildRetryEnvironmentConfiguration({
        DOCKER_BUILD_RETRY_DELAY_MS: '-1',
      }),
    ).toThrow('DOCKER_BUILD_RETRY_DELAY_MS must be a non-negative integer');
  });
});
