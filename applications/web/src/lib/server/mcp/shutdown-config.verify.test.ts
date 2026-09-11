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

  /** Headroom, in seconds, kill_timeout must leave past SHUTDOWN_TIMEOUT for the async pool disposal. */
  const DISPOSAL_HEADROOM_SECONDS = 2;

  it('sets SHUTDOWN_TIMEOUT and a kill_timeout with headroom past it', () => {
    const shutdownTimeoutSeconds = parseDurationSeconds(readValue(toml, 'SHUTDOWN_TIMEOUT'));
    const killTimeoutSeconds = parseDurationSeconds(readValue(toml, 'kill_timeout'));

    // A positive drain window, and Fly's SIGKILL deadline strictly *beyond* it
    // with headroom — both timers start at the shutdown signal, so if kill_timeout
    // merely equalled SHUTDOWN_TIMEOUT, Fly could SIGKILL at the same instant
    // adapter-node force-closes stragglers and emits `sveltekit:shutdown`, leaving
    // no time for the asynchronous OAuth pool disposal that begins from that event.
    expect(shutdownTimeoutSeconds).toBeGreaterThan(0);
    expect(killTimeoutSeconds - shutdownTimeoutSeconds).toBeGreaterThanOrEqual(
      DISPOSAL_HEADROOM_SECONDS,
    );

    // Fly caps kill_timeout at 300s; a value above that is silently rejected.
    expect(killTimeoutSeconds).toBeLessThanOrEqual(300);
  });

  it('leaves a stream-close margin between the grace window and SHUTDOWN_TIMEOUT', () => {
    // The transport close fires at the grace deadline and must end the listen
    // streams before adapter-node's force-close, so the grace has to sit below
    // SHUTDOWN_TIMEOUT by at least a stream-close margin.
    const STREAM_CLOSE_MARGIN_MS = 1_000;
    const shutdownTimeoutMs = parseDurationSeconds(readValue(toml, 'SHUTDOWN_TIMEOUT')) * 1000;
    expect(GRACE_BEFORE_TRANSPORT_SHUTDOWN_MS).toBeGreaterThan(0);
    expect(shutdownTimeoutMs - GRACE_BEFORE_TRANSPORT_SHUTDOWN_MS).toBeGreaterThanOrEqual(
      STREAM_CLOSE_MARGIN_MS,
    );
  });
});
