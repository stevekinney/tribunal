import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * TRI-51 AC3, the empirical half: adapter-node's shutdown behaviour must be
 * *established by running it*, not by reading the adapter source — and under the
 * production runtime, which is Bun (`bun build/index.js`), not the Node runtime
 * this Vitest suite runs in. So this test spawns a Bun subprocess that replicates
 * adapter-node's `graceful_shutdown` sequence over `node:http`, drives a slow
 * in-flight request through a shutdown, and exits 0 only if the shutdown callback
 * (adapter-node's `sveltekit:shutdown` emit point) waited for that request.
 *
 * The recorded result: it waits, and no custom in-flight tracking is needed —
 * Bun's `http.Server.close()` drains in-flight requests the way Node's does,
 * unlike `Bun.serve().stop(false)`, whose non-waiting behaviour motivated the
 * original criterion. This is why `hooks.server.ts` disposes on
 * `sveltekit:shutdown` alone rather than tracking requests itself.
 */

const here = dirname(fileURLToPath(import.meta.url));
const probePath = resolve(here, '../../../../test/mcp/adapter-node-shutdown-probe.ts');

describe('adapter-node graceful shutdown under Bun (TRI-51 AC3, empirical)', () => {
  it('waits for an in-flight request before emitting sveltekit:shutdown, with no custom tracking', () => {
    // `timeout` paired with SIGKILL per the repo rule: spawnSync's timeout
    // signals then waits, so a probe that traps SIGTERM would otherwise be
    // unbounded. The probe also self-terminates within 8s.
    const result = spawnSync('bun', [probePath], {
      encoding: 'utf8',
      timeout: 20_000,
      killSignal: 'SIGKILL',
    });

    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
    const diagnostic = result.error ? `${result.error.message}\n${output}` : output;

    // Exit 0 means the in-flight request completed before the shutdown callback
    // fired; the JSON line records the observation for the reader.
    expect(result.status, diagnostic).toBe(0);
    expect(output).toContain('"shutdownWaitedForInFlight":true');
    expect(output).toContain('"ok":true');
  });
});
