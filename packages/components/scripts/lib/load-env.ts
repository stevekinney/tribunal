/**
 * Environment loader utility for scripts.
 *
 * Explicitly loads the .env file from the current working directory
 * to ensure port and configuration values are available.
 *
 * This is necessary because:
 * 1. Pre-commit hooks may not inherit environment variables
 * 2. Bun's auto-loading of .env can be inconsistent in some contexts
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Parses a .env file and returns key-value pairs.
 * Handles quoted values and ignores comments.
 */
function parseEnvFile(content: string): Record<string, string> {
  const env: Record<string, string> = {};

  for (const line of content.split('\n')) {
    const trimmed = line.trim();

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Find the first = sign
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;

    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();

    // Remove surrounding quotes if present
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (key) {
      env[key] = value;
    }
  }

  return env;
}

/**
 * Loads environment variables from .env file into process.env.
 * Does not override existing environment variables.
 *
 * @param cwd - The directory to search for .env file (defaults to process.cwd())
 * @returns Object with loaded keys and whether .env was found
 */
export function loadEnv(cwd?: string): { loaded: string[]; found: boolean } {
  const dir = cwd ?? process.cwd();
  const envPath = join(resolve(dir), '.env');

  if (!existsSync(envPath)) {
    return { loaded: [], found: false };
  }

  const content = readFileSync(envPath, 'utf-8');
  const parsed = parseEnvFile(content);
  const loaded: string[] = [];

  for (const [key, value] of Object.entries(parsed)) {
    // Don't override existing environment variables
    if (process.env[key] === undefined) {
      process.env[key] = value;
      loaded.push(key);
    }
  }

  return { loaded, found: true };
}
