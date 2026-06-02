import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Verifies a GitHub webhook signature using HMAC-SHA256.
 *
 * @param payload - The raw request body as a string
 * @param signature - The signature from x-hub-signature-256 header
 * @param secret - The webhook secret configured in GitHub
 * @returns true if the signature is valid, false otherwise
 */
export async function verifyWebhookSignature(
  payload: string,
  signature: string | null,
  secret: string,
): Promise<boolean> {
  if (!signature || !signature.startsWith('sha256=')) return false;

  const provided = Buffer.from(signature.slice('sha256='.length), 'hex');
  const hmac = createHmac('sha256', secret);
  hmac.update(payload, 'utf8');
  const computed = hmac.digest();

  if (provided.length !== computed.length) return false;

  return timingSafeEqual(provided, computed);
}
