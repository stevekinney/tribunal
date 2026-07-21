import { describe, expect, it } from 'vitest';
import { MAX_PAYLOAD_SIZE } from './types.js';

describe('MAX_PAYLOAD_SIZE', () => {
  it('is 5MB, expressed in bytes', () => {
    expect(MAX_PAYLOAD_SIZE).toBe(5 * 1024 * 1024);
  });
});
