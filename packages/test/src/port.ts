/**
 * Port finder utility for Playwright tests.
 *
 * Finds an available port, preferring a specified port if available.
 * Used to prevent port collisions when running tests in parallel
 * (e.g., across multiple git worktrees).
 */

import { createServer } from 'node:net';

/**
 * Find a free port, preferring the specified port if available.
 *
 * @param preferredPort - The port to try first (default: 4173)
 * @returns A promise that resolves to an available port number
 *
 * @example
 * ```typescript
 * const port = await findFreePort(4173);
 * // Returns 4173 if available, otherwise a random available port
 * ```
 */
export function findFreePort(preferredPort = 4173): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();

    // Keep a mutable reference so the listening handler always clears the
    // currently-active timeout, whether it is the original or the fallback one.
    let activeTimeout = setTimeout(() => {
      server.close();
      reject(
        new Error(
          `[tribunal-test:port] Timed out after 5000ms trying to find a free port ` +
            `(preferred: ${preferredPort})`,
        ),
      );
    }, 5_000);

    server.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') {
        // Preferred port is in use. Clear the original timeout so the fallback
        // gets a full 5s budget, then attempt to bind on a random available port.
        clearTimeout(activeTimeout);
        activeTimeout = setTimeout(() => {
          server.close();
          reject(
            new Error(
              `[tribunal-test:port] Timed out after 5000ms trying to find a free port ` +
                `(preferred: ${preferredPort})`,
            ),
          );
        }, 5_000);
        server.listen(0, '127.0.0.1');
      } else {
        clearTimeout(activeTimeout);
        reject(error);
      }
    });

    server.on('listening', () => {
      clearTimeout(activeTimeout);
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });

    server.listen(preferredPort, '127.0.0.1');
  });
}
