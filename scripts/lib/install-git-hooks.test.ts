import { describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { installGitHooks } from './install-git-hooks';

describe('installGitHooks', () => {
  it('bounds hook installation and returns a distinct timeout exit code', () => {
    const slowCommand = vi.fn((_command, _arguments, options) => {
      expect(options.timeout).toBe(30_000);
      expect(options.killSignal).toBe('SIGKILL');
      return spawnSync(process.execPath, ['-e', 'setTimeout(() => {}, 1_000)'], {
        ...options,
        timeout: 10,
        killSignal: 'SIGKILL',
      });
    });
    const reportTimeout = vi.fn();

    expect(installGitHooks(slowCommand, reportTimeout)).toBe(124);
    expect(reportTimeout).toHaveBeenCalledOnce();
  });

  it('returns the hook installer status on an ordinary completion', () => {
    const completedCommand = vi.fn(() => ({ status: 0 }));

    expect(installGitHooks(completedCommand)).toBe(0);
  });
});
