#!/usr/bin/env bun

import { runDockerBuildWithRetry, type CommandResult } from './lib/docker-build-retry';

function readPositiveIntegerEnvironmentValue(name: string, fallback: number): number {
  const rawValue = process.env[name];
  if (!rawValue) return fallback;
  if (!/^\d+$/.test(rawValue)) {
    throw new Error(`${name} must be a positive integer`);
  }
  const value = Number(rawValue);
  if (value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

const command = process.argv.slice(2);

try {
  await runDockerBuildWithRetry({
    command,
    spawnCommand,
    maximumAttempts: readPositiveIntegerEnvironmentValue('DOCKER_BUILD_MAXIMUM_ATTEMPTS', 3),
    retryDelayMs: readPositiveIntegerEnvironmentValue('DOCKER_BUILD_RETRY_DELAY_MS', 10_000),
    wallClockTimeoutMs: readPositiveIntegerEnvironmentValue(
      'DOCKER_BUILD_WALL_CLOCK_TIMEOUT_MS',
      900_000,
    ),
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

async function spawnCommand(
  command: string[],
  options: { timeoutMs: number },
): Promise<CommandResult> {
  const subprocess = Bun.spawn(command, {
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const stdout = new Response(subprocess.stdout).text();
  const stderr = new Response(subprocess.stderr).text();
  const timeout = Bun.sleep(options.timeoutMs).then(() => 'timeout' as const);
  const exited = subprocess.exited.then((exitCode) => ({ exitCode }));
  const outcome = await Promise.race([exited, timeout]);

  if (outcome === 'timeout') {
    subprocess.kill('SIGTERM');
    await Bun.sleep(1_000);
    if (subprocess.exitCode === null) {
      subprocess.kill('SIGKILL');
    }
  }

  const [stdoutText, stderrText] = await Promise.all([stdout, stderr]);
  const output = [stdoutText, stderrText].filter(Boolean).join('\n');

  if (outcome === 'timeout') {
    return { exitCode: subprocess.exitCode, output, timedOut: true };
  }

  return { exitCode: outcome.exitCode, output, timedOut: false };
}
