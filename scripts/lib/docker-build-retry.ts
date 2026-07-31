export interface DockerBuildRetryOptions {
  command: string[];
  maximumAttempts?: number;
  retryDelayMs?: number;
  wallClockTimeoutMs?: number;
  spawnCommand: SpawnCommand;
  sleep?: (delayMs: number) => Promise<void>;
  now?: () => number;
  log?: Pick<Console, 'error' | 'log' | 'warn'>;
}

export interface CommandResult {
  exitCode: number | null;
  output: string;
  timedOut: boolean;
}

export type SpawnCommand = (
  command: string[],
  options: { timeoutMs: number },
) => Promise<CommandResult>;

const DEFAULT_MAXIMUM_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 10_000;
const DEFAULT_WALL_CLOCK_TIMEOUT_MS = 900_000;

export function isTransientDockerRegistryResolutionTimeout(output: string): boolean {
  const normalizedOutput = output.toLowerCase();
  const referencesDockerHub =
    normalizedOutput.includes('registry-1.docker.io') ||
    normalizedOutput.includes('auth.docker.io') ||
    normalizedOutput.includes('docker.io/oven/bun') ||
    normalizedOutput.includes('oven/bun');
  const referencesMetadataResolution =
    normalizedOutput.includes('resolve source metadata') ||
    normalizedOutput.includes('/manifests/') ||
    normalizedOutput.includes('failed to fetch anonymous token') ||
    normalizedOutput.includes('failed to resolve');
  const referencesTimeout =
    normalizedOutput.includes('i/o timeout') ||
    normalizedOutput.includes('tls handshake timeout') ||
    normalizedOutput.includes('client.timeout exceeded') ||
    normalizedOutput.includes('context deadline exceeded');

  return referencesDockerHub && referencesMetadataResolution && referencesTimeout;
}

export async function runDockerBuildWithRetry(options: DockerBuildRetryOptions): Promise<void> {
  const maximumAttempts = options.maximumAttempts ?? DEFAULT_MAXIMUM_ATTEMPTS;
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  const wallClockTimeoutMs = options.wallClockTimeoutMs ?? DEFAULT_WALL_CLOCK_TIMEOUT_MS;
  const spawnCommand = options.spawnCommand;
  const sleep = options.sleep ?? Bun.sleep;
  const now = options.now ?? Date.now;
  const log = options.log ?? console;

  if (options.command.length === 0) {
    throw new Error('Docker build retry command must include at least one argument');
  }
  if (!Number.isInteger(maximumAttempts) || maximumAttempts < 1) {
    throw new Error('maximumAttempts must be a positive integer');
  }
  if (!Number.isInteger(retryDelayMs) || retryDelayMs < 0) {
    throw new Error('retryDelayMs must be a non-negative integer');
  }
  if (!Number.isInteger(wallClockTimeoutMs) || wallClockTimeoutMs < 1) {
    throw new Error('wallClockTimeoutMs must be a positive integer');
  }

  const startedAt = now();
  const deadline = startedAt + wallClockTimeoutMs;

  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    const remainingMs = deadline - now();
    if (remainingMs <= 0) {
      throw new Error(
        `Docker build retry budget expired before attempt ${attempt} after ${wallClockTimeoutMs}ms`,
      );
    }

    log.log(`Running docker build attempt ${attempt}/${maximumAttempts}`);
    const result = await spawnCommand(options.command, { timeoutMs: remainingMs });
    if (result.output.length > 0) {
      log.log(result.output.trimEnd());
    }
    if (result.exitCode === 0) {
      return;
    }

    const retryable = isTransientDockerRegistryResolutionTimeout(result.output);
    const finalAttempt = attempt === maximumAttempts;
    const elapsedMs = now() - startedAt;

    if (result.timedOut) {
      throw new Error(
        `Docker build exceeded ${wallClockTimeoutMs}ms wall-clock retry budget after ${attempt} attempt(s)`,
      );
    }

    if (!retryable) {
      throw new Error(`Docker build failed with exit code ${result.exitCode ?? 'unknown'}`);
    }

    if (finalAttempt) {
      throw new Error(
        `Docker build failed after ${maximumAttempts} transient registry timeout attempt(s) in ${elapsedMs}ms`,
      );
    }

    const delayMs = Math.min(retryDelayMs, Math.max(0, deadline - now()));
    if (delayMs === 0) {
      throw new Error(
        `Docker build retry budget expired after transient registry timeout on attempt ${attempt}`,
      );
    }

    log.warn(
      `Docker Hub base-image metadata timed out on attempt ${attempt}/${maximumAttempts}; retrying in ${delayMs}ms`,
    );
    await sleep(delayMs);
  }
}
