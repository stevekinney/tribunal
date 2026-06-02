/**
 * Request validation for GitHub webhooks.
 */

import { error } from '@sveltejs/kit';
import { verifyWebhookSignature } from '@tribunal/github/webhooks/verify-webhook-signature';
import { MAX_PAYLOAD_SIZE } from '@tribunal/github/webhooks/types';

export interface ValidatedRequest {
  payload: string;
  signature: string | null;
  eventType: string | null;
  deliveryId: string | null;
}

/**
 * Validate and extract webhook request data.
 * Performs size checks and reads payload.
 * @throws SvelteKit error on validation failure
 */
export async function validateRequest(request: Request): Promise<ValidatedRequest> {
  // Check Content-Length header first (fast rejection)
  const contentLength = request.headers.get('content-length');
  if (contentLength && parseInt(contentLength, 10) > MAX_PAYLOAD_SIZE) {
    console.warn(`Rejecting webhook: Content-Length ${contentLength} exceeds ${MAX_PAYLOAD_SIZE}`);
    error(413, 'Payload too large');
  }

  const payload = await request.text();

  // Verify actual byte size (in case Content-Length was missing or spoofed)
  // Use Buffer.byteLength to count UTF-8 bytes, not UTF-16 code units
  const payloadByteLength = Buffer.byteLength(payload, 'utf8');
  if (payloadByteLength > MAX_PAYLOAD_SIZE) {
    console.warn(
      `Rejecting webhook: actual payload size ${payloadByteLength} bytes exceeds ${MAX_PAYLOAD_SIZE}`,
    );
    error(413, 'Payload too large');
  }

  const signature = request.headers.get('x-hub-signature-256');
  const eventType = request.headers.get('x-github-event');
  const deliveryId = request.headers.get('x-github-delivery');

  return { payload, signature, eventType, deliveryId };
}

/**
 * Verify webhook signature using HMAC-SHA256.
 * @throws SvelteKit error on invalid signature
 */
export async function verifySignature(
  payload: string,
  signature: string | null,
  secret: string,
  context?: { deliveryId?: string | null; eventType?: string | null },
): Promise<void> {
  const isValid = await verifyWebhookSignature(payload, signature, secret);
  if (!isValid) {
    console.warn('[webhook] Signature verification failed', {
      deliveryId: context?.deliveryId ?? 'unknown',
      eventType: context?.eventType ?? 'unknown',
      hasSignatureHeader: signature !== null,
      signaturePrefix: signature?.slice(0, 7) ?? null,
      payloadByteLength: Buffer.byteLength(payload, 'utf8'),
      secretConfigured: secret.length > 0,
      secretLength: secret.length,
    });
    error(401, 'Invalid webhook signature');
  }
}
