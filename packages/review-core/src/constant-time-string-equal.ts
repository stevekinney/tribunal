import { timingSafeEqual } from 'node:crypto';

/**
 * Constant-time comparison of two secret strings.
 *
 * Converts both strings to UTF-8 `Buffer`s and uses `node:crypto`'s
 * `timingSafeEqual` so the comparison time does not leak how many leading bytes
 * matched. The length-mismatch short-circuit only reveals that the lengths
 * differ — it cannot be used to reconstruct the secret value.
 *
 * Use this wherever a secret (API token, HMAC signature segment, OAuth state)
 * is compared against a user-supplied value.
 */
export function constantTimeStringEqual(received: string, expected: string): boolean {
  const receivedBuffer = Buffer.from(received, 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');

  if (receivedBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(receivedBuffer, expectedBuffer);
}
