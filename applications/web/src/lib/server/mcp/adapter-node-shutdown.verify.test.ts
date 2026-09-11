import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * TRI-51 AC3, the empirical half: adapter-node's shutdown behaviour must be
 * *established by running it*, not by reading the adapter source — and under the
 * production runtime, which is Bun (`bun build/index.js`), not the Node runtime
 * this Vitest suite runs in. So this test spawns a Bun subprocess that replicates
 * adapter-node's `graceful_shutdown` sequence over `node:http` and drives
 * Tribunal's two-phase shutdown through it.
 *
 * The recorded result (exit 0): Bun's `http.Server.close()` waits for an ordinary
 * in-flight request before its callback (adapter-node's `sveltekit:shutdown` emit
 * point) fires — so no custom in-flight tracking is needed, unlike
 * `Bun.serve().stop(false)`, whose non-waiting behaviour motivated the original
 * criterion. A long-lived `subscriptions/listen`-style stream, ended by the
 * transport-shutdown step rather than left open, lets the drain finish promptly
 * instead of hanging to the force-close timer. And because that transport close —
 * which, faithful to `handler.close()`, aborts in-flight ordinary calls — is
 * deferred by the bounded grace window while adapter-node drains, the ordinary
 * call completes first and is never aborted. This is why `hooks.server.ts` waits
 * a grace window then closes the transport on the signal (phase 1) and disposes
 * the pool only on `sveltekit:shutdown` (phase 2).
 */

const here = dirname(fileURLToPath(import.meta.url));
const probePath = resolve(here, '../../../../test/mcp/adapter-node-shutdown-probe.ts');

describe('adapter-node graceful shutdown under Bun (TRI-51 AC3, empirical)', () => {
  it('drains ordinary requests, protects them with the grace window, and closes listen streams without the force timer', () => {
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

    // Exit 0 means: the ordinary request drained (not aborted), the grace window
    // protected it, the long-lived stream closed gracefully, and the force-close
    // path never ran. The JSON line records the observation for the reader.
    expect(result.status, diagnostic).toBe(0);
    expect(output).toContain('"ordinaryDrained":true');
    expect(output).toContain('"graceProtectedOrdinary":true');
    expect(output).toContain('"streamClosedGracefully":true');
    expect(output).toContain('"forceCloseFired":false');
    expect(output).toContain('"ok":true');
  });
});
