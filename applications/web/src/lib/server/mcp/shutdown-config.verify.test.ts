import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { GRACE_BEFORE_TRANSPORT_SHUTDOWN_MS } from '../../../hooks.server';

/**
 * TRI-51 AC3: graceful shutdown must actually reach the web process's resource
 * disposal in production. adapter-node disposes nothing itself — it drains
 * in-flight requests, force-closes stragglers after `SHUTDOWN_TIMEOUT`, and only
 * then emits `sveltekit:shutdown`, which is where `hooks.server.ts` disposes the
 * MCP mount, OAuth pool, and cleanup sweep. Fly's `kill_timeout` is the hard
 * SIGKILL deadline; if it is shorter than the drain window, the process is killed
 * mid-drain and that disposal never runs. This locks in `kill_timeout >=
 * SHUTDOWN_TIMEOUT` so a future edit to either value cannot silently re-break the
 * ordering — the same "committed config is the source of truth" guard the
 * `BODY_SIZE_LIMIT` verify test applies to the same file.
 */

const here = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(here, '../../../../../..');
const webTomlPath = resolve(repositoryRoot, 'deployment/fly/web.toml');

/** Parses a Fly duration (`"20s"`, `"2m"`, `"1h"`) or a bare integer of seconds to seconds. */
function parseDurationSeconds(value: string): number {
  const match = value.trim().match(/^(\d+)\s*(s|m|h)?$/);
  if (!match) throw new Error(`Unparseable duration: ${value}`);
  const amount = Number(match[1]);
  const unit = match[2] ?? 's';
  const factor = unit === 'h' ? 3600 : unit === 'm' ? 60 : 1;
  return amount * factor;
}

function readValue(toml: string, key: string): string {
  const match = toml.match(new RegExp(`^\\s*${key}\\s*=\\s*"([^"]+)"`, 'm'));
  if (!match) throw new Error(`${key} is not set in deployment/fly/web.toml`);
  return match[1]!;
}

describe('web.toml graceful-shutdown configuration (TRI-51 AC3)', () => {
  const toml = readFileSync(webTomlPath, 'utf8');

  it('sets SHUTDOWN_TIMEOUT and a kill_timeout that covers it', () => {
    const shutdownTimeoutSeconds = parseDurationSeconds(readValue(toml, 'SHUTDOWN_TIMEOUT'));
    const killTimeoutSeconds = parseDurationSeconds(readValue(toml, 'kill_timeout'));

    // A positive drain window, and Fly's SIGKILL deadline at or beyond it, so the
    // drain, `sveltekit:shutdown` disposal, and exit all complete before the kill.
    expect(shutdownTimeoutSeconds).toBeGreaterThan(0);
    expect(killTimeoutSeconds).toBeGreaterThanOrEqual(shutdownTimeoutSeconds);

    // Fly caps kill_timeout at 300s; a value above that is silently rejected.
    expect(killTimeoutSeconds).toBeLessThanOrEqual(300);
  });

  it('keeps the transport-shutdown grace window well under SHUTDOWN_TIMEOUT', () => {
    // The pre-drain grace (hooks.server.ts) must fire and the transport close
    // must end the listen streams before adapter-node's force-close, so the
    // grace has to be strictly less than the drain window it runs inside.
    const shutdownTimeoutMs = parseDurationSeconds(readValue(toml, 'SHUTDOWN_TIMEOUT')) * 1000;
    expect(GRACE_BEFORE_TRANSPORT_SHUTDOWN_MS).toBeGreaterThan(0);
    expect(GRACE_BEFORE_TRANSPORT_SHUTDOWN_MS).toBeLessThan(shutdownTimeoutMs);
  });
});
