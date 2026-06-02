import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock SvelteKit error to throw like the real implementation
vi.mock('@sveltejs/kit', () => ({
  error: (status: number, message: string) => {
    throw { status, message, type: 'error' };
  },
}));

// Mock the underlying signature verification
vi.mock('@tribunal/github/webhooks/verify-webhook-signature', () => ({
  verifyWebhookSignature: vi.fn(),
}));

import { verifySignature } from './request';
import { verifyWebhookSignature } from '@tribunal/github/webhooks/verify-webhook-signature';

describe('verifySignature', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not log on successful verification', async () => {
    vi.mocked(verifyWebhookSignature).mockResolvedValue(true);
    const warnSpy = vi.spyOn(console, 'warn');

    await verifySignature('{"test":true}', 'sha256=abc123', 'secret');

    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('logs diagnostic info on signature failure', async () => {
    vi.mocked(verifyWebhookSignature).mockResolvedValue(false);
    const warnSpy = vi.spyOn(console, 'warn');

    try {
      await verifySignature('{"test":true}', 'sha256=abc123', 'my-secret', {
        deliveryId: 'delivery-123',
        eventType: 'push',
      });
    } catch {
      // Expected 401 error
    }

    expect(warnSpy).toHaveBeenCalledWith('[webhook] Signature verification failed', {
      deliveryId: 'delivery-123',
      eventType: 'push',
      hasSignatureHeader: true,
      signaturePrefix: 'sha256=',
      payloadByteLength: 13,
      secretConfigured: true,
      secretLength: 9,
    });
    warnSpy.mockRestore();
  });

  it('logs defaults when context is not provided', async () => {
    vi.mocked(verifyWebhookSignature).mockResolvedValue(false);
    const warnSpy = vi.spyOn(console, 'warn');

    try {
      await verifySignature('{}', 'sha256=abc', 'secret');
    } catch {
      // Expected 401 error
    }

    expect(warnSpy).toHaveBeenCalledWith(
      '[webhook] Signature verification failed',
      expect.objectContaining({
        deliveryId: 'unknown',
        eventType: 'unknown',
      }),
    );
    warnSpy.mockRestore();
  });

  it('logs null signature prefix when signature header is missing', async () => {
    vi.mocked(verifyWebhookSignature).mockResolvedValue(false);
    const warnSpy = vi.spyOn(console, 'warn');

    try {
      await verifySignature('{}', null, 'secret', {
        deliveryId: 'delivery-456',
        eventType: 'pull_request',
      });
    } catch {
      // Expected 401 error
    }

    expect(warnSpy).toHaveBeenCalledWith(
      '[webhook] Signature verification failed',
      expect.objectContaining({
        hasSignatureHeader: false,
        signaturePrefix: null,
      }),
    );
    warnSpy.mockRestore();
  });

  it('does not log the secret value or full signature', async () => {
    vi.mocked(verifyWebhookSignature).mockResolvedValue(false);
    const warnSpy = vi.spyOn(console, 'warn');
    const secret = 'super-secret-webhook-key-12345';
    const signature = 'sha256=a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';

    try {
      await verifySignature('{}', signature, secret, {
        deliveryId: 'test',
        eventType: 'push',
      });
    } catch {
      // Expected 401 error
    }

    const loggedArgs = warnSpy.mock.calls[0];
    const loggedObject = loggedArgs[1] as Record<string, unknown>;

    // Should not contain the secret value
    const logString = JSON.stringify(loggedObject);
    expect(logString).not.toContain(secret);

    // Should only log the "sha256=" prefix, not the hash
    expect(loggedObject.signaturePrefix).toBe('sha256=');
    expect(logString).not.toContain('a1b2c3d4e5f6');

    // Should log secret length, not the secret itself
    expect(loggedObject.secretLength).toBe(secret.length);

    warnSpy.mockRestore();
  });

  it('detects empty secret configuration', async () => {
    vi.mocked(verifyWebhookSignature).mockResolvedValue(false);
    const warnSpy = vi.spyOn(console, 'warn');

    try {
      await verifySignature('{}', 'sha256=abc', '', {
        deliveryId: 'test',
        eventType: 'push',
      });
    } catch {
      // Expected 401 error
    }

    expect(warnSpy).toHaveBeenCalledWith(
      '[webhook] Signature verification failed',
      expect.objectContaining({
        secretConfigured: false,
        secretLength: 0,
      }),
    );
    warnSpy.mockRestore();
  });

  it('throws 401 error on invalid signature', async () => {
    vi.mocked(verifyWebhookSignature).mockResolvedValue(false);

    expect.assertions(2);
    try {
      await verifySignature('{}', 'sha256=invalid', 'secret');
    } catch (e) {
      const errorData = e as { status: number; message: string };
      expect(errorData.status).toBe(401);
      expect(errorData.message).toBe('Invalid webhook signature');
    }
  });
});
