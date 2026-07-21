import { describe, it, expect } from 'vitest';
import { verifyWebhookSignature } from './verify-webhook-signature.js';

describe('verifyWebhookSignature', () => {
  const secret = 'test-webhook-secret';

  async function generateSignature(payload: string, secret: string): Promise<string> {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );

    const signatureBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
    return (
      'sha256=' +
      Array.from(new Uint8Array(signatureBuffer))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
    );
  }

  it('returns true for valid signature', async () => {
    const payload = JSON.stringify({ action: 'created', installation: { id: 123 } });
    const signature = await generateSignature(payload, secret);

    const result = await verifyWebhookSignature(payload, signature, secret);

    expect(result).toBe(true);
  });

  it('returns false for invalid signature', async () => {
    const payload = JSON.stringify({ action: 'created', installation: { id: 123 } });
    const invalidSignature =
      'sha256=invalid0000000000000000000000000000000000000000000000000000000000';

    const result = await verifyWebhookSignature(payload, invalidSignature, secret);

    expect(result).toBe(false);
  });

  it('returns false for missing signature', async () => {
    const payload = JSON.stringify({ action: 'created', installation: { id: 123 } });

    const result = await verifyWebhookSignature(payload, null, secret);

    expect(result).toBe(false);
  });

  it('returns false for tampered payload', async () => {
    const originalPayload = JSON.stringify({ action: 'created', installation: { id: 123 } });
    const tamperedPayload = JSON.stringify({ action: 'deleted', installation: { id: 123 } });
    const signature = await generateSignature(originalPayload, secret);

    const result = await verifyWebhookSignature(tamperedPayload, signature, secret);

    expect(result).toBe(false);
  });

  it('returns false for wrong secret', async () => {
    const payload = JSON.stringify({ action: 'created', installation: { id: 123 } });
    const signature = await generateSignature(payload, 'different-secret');

    const result = await verifyWebhookSignature(payload, signature, secret);

    expect(result).toBe(false);
  });
});
