import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { env } from '$env/dynamic/private';

const ALGORITHM = 'aes-256-gcm';

/**
 * Hashes a string with SHA-256 and returns a lowercase hex digest.
 */
export function hashWithSha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function getEncryptionKey(): Buffer {
  if (!env.ENCRYPTION_KEY) {
    throw new Error('ENCRYPTION_KEY is not set');
  }

  const key = Buffer.from(env.ENCRYPTION_KEY, 'hex');

  if (key.length !== 32) {
    throw new Error('ENCRYPTION_KEY must be 32 bytes (64 hex characters)');
  }

  return key;
}

/**
 * Encrypts a plaintext string using AES-256-GCM.
 * Returns a string in the format: iv:authTag:ciphertext (all hex-encoded)
 */
export function encrypt(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(16);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag().toString('hex');

  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

/**
 * Decrypts an encrypted string (iv:authTag:ciphertext format) using AES-256-GCM.
 * Returns the original plaintext.
 */
export function decrypt(encryptedData: string): string {
  const key = getEncryptionKey();
  const [ivHex, authTagHex, encrypted] = encryptedData.split(':');

  if (!ivHex || !authTagHex || !encrypted) {
    throw new Error('Invalid encrypted data format');
  }

  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));

  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}
