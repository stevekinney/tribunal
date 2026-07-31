#!/usr/bin/env bun

import {
  readDockerBuildRetryEnvironmentConfiguration,
  runDockerBuildWithRetry,
  type CommandResult,
} from './lib/docker-build-retry';

const STREAM_COLLECTION_TIMEOUT_MS = 1_000;

if (import.meta.main) {
  await main(process.argv.slice(2));
}

async function main(command: string[]): Promise<void> {
  try {
    const retryConfiguration = readDockerBuildRetryEnvironmentConfiguration(process.env);
    await runDockerBuildWithRetry({
      command,
      spawnCommand,
      ...retryConfiguration,
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

export async function spawnCommand(
  command: string[],
  options: { timeoutMs: number },
): Promise<CommandResult> {
  const subprocess = Bun.spawn(command, {
    detached: true,
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const stdout = collectStream(subprocess.stdout);
  const stderr = collectStream(subprocess.stderr);
  const timeout = createCancellableTimeout(options.timeoutMs);
  const exited = subprocess.exited.then((exitCode) => ({ exitCode }));
  const outcome = await Promise.race([exited, timeout.promise]);
  timeout.cancel();

  if (outcome === 'timeout') {
    killSubprocessGroup(subprocess, 'SIGTERM');
    const exitedAfterTerminate = await waitForSubprocessExit(subprocess, 1_000);
    if (!exitedAfterTerminate) {
      killSubprocessGroup(subprocess, 'SIGKILL');
      const exitedAfterKill = await waitForSubprocessExit(subprocess, 5_000);
      if (!exitedAfterKill) {
        const [stdoutText, stderrText] = await Promise.all([stdout.cancel(), stderr.cancel()]);
        const output = [
          stdoutText,
          stderrText,
          'Docker build subprocess did not exit after SIGKILL',
        ]
          .filter(Boolean)
          .join('\n');
        return { exitCode: subprocess.exitCode, output, timedOut: true };
      }
    }
    const [stdoutText, stderrText] = await collectTimedOutOutput(stdout, stderr);
    const output = [stdoutText, stderrText].filter(Boolean).join('\n');
    return { exitCode: subprocess.exitCode, output, timedOut: true };
  }

  const [stdoutText, stderrText] = await Promise.all([stdout.promise, stderr.promise]);
  const output = [stdoutText, stderrText].filter(Boolean).join('\n');

  return { exitCode: outcome.exitCode, output, timedOut: false };
}

function createCancellableTimeout(timeoutMs: number): {
  promise: Promise<'timeout'>;
  cancel: () => void;
} {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  return {
    promise: new Promise((resolve) => {
      timeoutId = setTimeout(() => resolve('timeout'), timeoutMs);
    }),
    cancel: () => {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
    },
  };
}

async function waitForSubprocessExit(
  subprocess: Bun.Subprocess<'ignore', 'pipe', 'pipe'>,
  timeoutMs: number,
): Promise<boolean> {
  return Promise.race([subprocess.exited.then(() => true), Bun.sleep(timeoutMs).then(() => false)]);
}

function killSubprocessGroup(
  subprocess: Bun.Subprocess<'ignore', 'pipe', 'pipe'>,
  signal: NodeJS.Signals,
): void {
  if (process.platform !== 'win32') {
    try {
      process.kill(-subprocess.pid, signal);
      return;
    } catch (error) {
      if (isNoSuchProcessError(error)) return;
    }
  }
  subprocess.kill(signal);
}

function isNoSuchProcessError(error: unknown): boolean {
  return error instanceof Error && (error as { code?: string }).code === 'ESRCH';
}

async function collectTimedOutOutput(
  stdout: CollectedStream,
  stderr: CollectedStream,
): Promise<[string, string]> {
  return Promise.race([
    Promise.all([stdout.promise, stderr.promise]),
    Bun.sleep(STREAM_COLLECTION_TIMEOUT_MS).then(() =>
      Promise.all([stdout.cancel(), stderr.cancel()]),
    ),
  ]);
}

interface CollectedStream {
  promise: Promise<string>;
  cancel: () => Promise<string>;
}

function collectStream(stream: ReadableStream<Uint8Array>): CollectedStream {
  const decoder = new TextDecoder();
  const reader = stream.getReader();
  const chunks: string[] = [];
  let cancelled = false;

  const promise = (async () => {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(decoder.decode(value, { stream: true }));
      }
      chunks.push(decoder.decode());
    } catch (error) {
      if (!cancelled) throw error;
    }
    return chunks.join('');
  })();

  return {
    promise,
    cancel: async () => {
      cancelled = true;
      await reader.cancel().catch(() => undefined);
      return promise.catch(() => chunks.join(''));
    },
  };
}
