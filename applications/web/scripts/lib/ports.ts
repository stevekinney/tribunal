/**
 * Development and test server port configuration.
 *
 * Provides the base ports for the web app's tooling plus an environment-variable
 * override helper. Ports default to the values below and can be overridden per
 * tool via the matching environment variable.
 */

/** Base ports for each tool. */
export const BASE_PORTS = {
  /** Vite dev server port. */
  viteDev: 5173,
  /** Vite preview server port. */
  vitePreview: 4173,
  /** Vitest browser API port. */
  vitestBrowser: 63315,
  /** Playwright webserver base port. */
  playwright: 3100,
} as const;

/**
 * Returns a port value, preferring a valid environment variable over the
 * provided default. Logs a warning if the environment variable is set but
 * invalid (out of the 1-65535 range or non-numeric).
 *
 * @param envKey - Environment variable name (e.g. `'VITE_PORT'`).
 * @param defaultPort - The port to use when the environment variable is unset or invalid.
 * @returns The port from the environment variable if valid, otherwise `defaultPort`.
 */
export function getPortWithEnvOverride(envKey: string, defaultPort: number): number {
  const envValue = process.env[envKey];
  if (envValue) {
    const parsed = parseInt(envValue, 10);
    if (!isNaN(parsed) && parsed > 0 && parsed <= 65535) {
      return parsed;
    }
    console.warn(
      `Warning: Invalid ${envKey}="${envValue}" (expected 1-65535). Using default port ${defaultPort}.`,
    );
  }
  return defaultPort;
}
