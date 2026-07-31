import { execFile } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const scriptsDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');

describe('spawnCommand', () => {
  it('returns promptly when a timed-out child leaves a descendant holding output pipes open', async () => {
    const startedAt = performance.now();
    let thrownError: unknown;

    try {
      await execFileAsync(
        'bun',
        ['run', 'docker-build-with-retry.ts', 'sh', '-c', '(sleep 3)& wait'],
        {
          cwd: scriptsDirectory,
          env: {
            ...process.env,
            DOCKER_BUILD_MAXIMUM_ATTEMPTS: '1',
            DOCKER_BUILD_WALL_CLOCK_TIMEOUT_MS: '50',
          },
          timeout: 2_000,
        },
      );
    } catch (error) {
      thrownError = error;
    }

    expect(thrownError).toMatchObject({ code: 1, killed: false });
    expect(performance.now() - startedAt).toBeLessThan(2_000);
  });
});
