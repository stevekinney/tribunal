import { spawnSync } from 'node:child_process';

interface HookInstallerResult {
  error?: unknown;
  status: number | null;
}

type HookInstaller = (
  command: string,
  arguments_: string[],
  options: {
    killSignal: 'SIGKILL';
    stdio: 'inherit';
    timeout: number;
  },
) => HookInstallerResult;

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ETIMEDOUT';
}

export function installGitHooks(
  spawn: HookInstaller = spawnSync,
  reportTimeout: (message: string) => void = console.error,
): number {
  const result = spawn('lefthook', ['install'], {
    stdio: 'inherit',
    // Hook installation may download no dependencies and should complete
    // quickly, but allow slower fresh checkouts without blocking install forever.
    timeout: 30_000,
    killSignal: 'SIGKILL',
  });

  if (isTimeoutError(result.error)) {
    reportTimeout('Lefthook installation timed out after 30 seconds.');
    return 124;
  }

  return result.status ?? 1;
}
