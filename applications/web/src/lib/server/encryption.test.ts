import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockEnv = vi.hoisted(() => ({ ENCRYPTION_KEY: undefined as string | undefined }));

vi.mock('$env/dynamic/private', () => ({ env: mockEnv }));

import { decrypt, encrypt, hashWithSha256 } from './encryption';

const VALID_KEY = 'a'.repeat(64); // 32 bytes, hex-encoded

describe('hashWithSha256', () => {
  it('returns a stable lowercase hex digest', () => {
    const digest = hashWithSha256('hello world');

    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(hashWithSha256('hello world')).toBe(digest);
  });
});

describe('encrypt/decrypt', () => {
  beforeEach(() => {
    mockEnv.ENCRYPTION_KEY = VALID_KEY;
  });

  it('round-trips a plaintext string', () => {
    const ciphertext = encrypt('super secret token');

    expect(ciphertext.split(':')).toHaveLength(3);
    expect(decrypt(ciphertext)).toBe('super secret token');
  });

  it('throws when ENCRYPTION_KEY is not set', () => {
    mockEnv.ENCRYPTION_KEY = undefined;

    expect(() => encrypt('secret')).toThrow('ENCRYPTION_KEY is not set');
    expect(() => decrypt('a:b:c')).toThrow('ENCRYPTION_KEY is not set');
  });

  it('throws when ENCRYPTION_KEY is not 32 bytes', () => {
    mockEnv.ENCRYPTION_KEY = 'tooshort';

    expect(() => encrypt('secret')).toThrow('ENCRYPTION_KEY must be 32 bytes');
  });

  it('throws on malformed encrypted data missing a segment', () => {
    expect(() => decrypt('missing-segments')).toThrow('Invalid encrypted data format');
  });

  it('throws when the auth tag does not match (tampered ciphertext)', () => {
    const ciphertext = encrypt('super secret token');
    const [iv, authTag, encrypted] = ciphertext.split(':');
    // Flip the last byte via its bitwise complement rather than hardcoding a
    // replacement — encrypt() uses a random IV, so a hardcoded 'ff' has a
    // 1/256 chance of matching the real last byte and silently producing
    // untampered ciphertext (a flaky pass). XOR with 0xff always differs.
    const lastByte = parseInt(encrypted.slice(-2), 16);
    const flippedByte = (lastByte ^ 0xff).toString(16).padStart(2, '0');
    const tampered = `${iv}:${authTag}:${encrypted.slice(0, -2)}${flippedByte}`;

    expect(() => decrypt(tampered)).toThrow();
  });
});
