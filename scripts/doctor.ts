#!/usr/bin/env bun
/// <reference types="bun-types" />

import { resolve } from 'node:path';
const { sql } = await import('@tribunal/database/operators').catch(async () => {
  // Fall back to a direct source import when workspace links are unavailable.
  return import('../packages/database/src/operators.ts');
});
const { createDatabase } = await import('@tribunal/database').catch(async () => {
  // Fall back to a direct source import when workspace links are unavailable.
  return import('../packages/database/src/index.ts');
});
import { loadEnv } from './lib/load-env';
import { sectionHeader, status, success, error } from './lib/colors';

const REQUIRED_ENV_VARS = [
  'DATABASE_URL',
  'ENCRYPTION_KEY',
  'GITHUB_CLIENT_ID',
  'GITHUB_CLIENT_SECRET',
];

const repoRoot = resolve(import.meta.dir, '..');

type CheckResult = {
  level: 'success' | 'warning' | 'error';
  message: string;
};

function parseMajor(version: string): number | null {
  const match = version.trim().match(/v?(\d+)\./);
  if (!match) return null;
  return Number.parseInt(match[1], 10);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  });
}

async function checkEnvironment(): Promise<CheckResult> {
  const { found } = loadEnv(repoRoot);

  const missing = REQUIRED_ENV_VARS.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    const prefix = found
      ? 'Missing required env vars'
      : 'No .env file found and required env vars are missing';
    return {
      level: 'error',
      message: `${prefix}: ${missing.join(', ')} (copy .env.example and configure)`,
    };
  }

  if (!found) {
    return {
      level: 'warning',
      message: 'Environment variables configured (no .env file found, using shell env)',
    };
  }

  return { level: 'success', message: 'Environment variables configured' };
}

async function checkDatabase(): Promise<CheckResult> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    return {
      level: 'error',
      message: 'DATABASE_URL is not set (required to connect to Postgres)',
    };
  }

  try {
    const db = createDatabase(databaseUrl);
    await withTimeout(db.execute(sql`select 1`), 2000, 'Database connection');
    return { level: 'success', message: 'Database connection successful' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      level: 'error',
      message: `Database connection failed (${message})`,
    };
  }
}

async function checkNodeVersion(): Promise<CheckResult> {
  try {
    const result = await Bun.$`node --version`.quiet();
    const version = new TextDecoder().decode(result.stdout).trim();
    const major = parseMajor(version);
    if (!major) {
      return {
        level: 'error',
        message: `Unable to parse Node version (${version})`,
      };
    }

    if (major < 22) {
      return {
        level: 'error',
        message: `Node ${version} detected (requires 22.x+)`,
      };
    }

    return { level: 'success', message: `Node version ${version} detected` };
  } catch {
    return {
      level: 'error',
      message: 'Node not found (install Node 22+)',
    };
  }
}

function checkBunVersion(): CheckResult {
  const version = Bun.version;
  const major = parseMajor(version);

  if (!major) {
    return {
      level: 'error',
      message: `Unable to parse Bun version (${version})`,
    };
  }

  if (major < 1) {
    return {
      level: 'error',
      message: `Bun ${version} detected (requires Bun 1.x+)`,
    };
  }

  return { level: 'success', message: `Bun version ${version} detected` };
}

async function run(): Promise<void> {
  console.log(sectionHeader('Tribunal Doctor'));

  const results: CheckResult[] = [];

  results.push(await checkEnvironment());
  results.push(await checkDatabase());
  results.push(await checkNodeVersion());
  results.push(checkBunVersion());

  let hasError = false;

  for (const result of results) {
    if (result.level === 'error') hasError = true;
    console.log(status(result.level, result.message));
  }

  console.log('');

  if (hasError) {
    console.log(
      error('Setup incomplete. Fix the errors above and re-run `bun run scripts/doctor.ts`.'),
    );
    process.exit(1);
  }

  console.log(success("Setup complete! Run 'bun run dev' to start."));
}

run().catch((err) => {
  console.error(error(`Doctor failed: ${err instanceof Error ? err.message : String(err)}`));
  process.exit(1);
});
