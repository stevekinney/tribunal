import { createServer, type AddressInfo, type Server } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { findFreePort } from './port';

describe('findFreePort', () => {
  let blockingServer: Server | null = null;

  // Use a high random port that's less likely to be in use
  const TEST_PORT = 49152 + Math.floor(Math.random() * 1000);

  beforeEach(() => {
    blockingServer = null;
  });

  afterEach(async () => {
    if (blockingServer) {
      await new Promise<void>((resolve) => {
        blockingServer!.close(() => resolve());
      });
      blockingServer = null;
    }
  });

  it('returns the preferred port when available', async () => {
    // Use a random high port that's very unlikely to be in use
    const preferredPort = TEST_PORT;
    const port = await findFreePort(preferredPort);
    expect(port).toBe(preferredPort);
  });

  it('finds an alternative port when preferred port is in use', async () => {
    const preferredPort = TEST_PORT;

    // Block the port
    blockingServer = createServer();
    await new Promise<void>((resolve, reject) => {
      blockingServer!.on('error', reject);
      blockingServer!.listen(preferredPort, '127.0.0.1', () => resolve());
    });

    // findFreePort should return a different port
    const port = await findFreePort(preferredPort);
    expect(port).not.toBe(preferredPort);
    expect(port).toBeGreaterThan(0);
    expect(port).toBeLessThanOrEqual(65535);
  });

  it('returns a valid port number', async () => {
    const port = await findFreePort();
    expect(port).toBeGreaterThan(0);
    expect(port).toBeLessThanOrEqual(65535);
  });

  it('allows the returned port to be bound', async () => {
    const port = await findFreePort(TEST_PORT);

    // Verify we can actually bind to the returned port
    const testServer = createServer();
    await new Promise<void>((resolve, reject) => {
      testServer.on('error', reject);
      testServer.listen(port, '127.0.0.1', () => {
        const address = testServer.address() as AddressInfo;
        expect(address.port).toBe(port);
        testServer.close(() => resolve());
      });
    });
  });

  it('uses default port 4173 when available or finds alternative', async () => {
    // When no argument provided, it defaults to 4173
    const port = await findFreePort();

    // Port should be valid (either 4173 if available, or another valid port)
    expect(port).toBeGreaterThan(0);
    expect(port).toBeLessThanOrEqual(65535);
  });

  it('handles concurrent calls', async () => {
    // Make concurrent calls
    const [port1, port2] = await Promise.all([
      findFreePort(TEST_PORT),
      findFreePort(TEST_PORT + 1),
    ]);

    // Both should be valid ports
    expect(port1).toBeGreaterThan(0);
    expect(port2).toBeGreaterThan(0);
    expect(port1).toBeLessThanOrEqual(65535);
    expect(port2).toBeLessThanOrEqual(65535);
  });
});
