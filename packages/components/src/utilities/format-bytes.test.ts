import { describe, it, expect } from 'vitest';
import { formatBytes } from './format-bytes';

describe('formatBytes', () => {
  it('returns bytes for values under 1 KB', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1)).toBe('1 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1023)).toBe('1023 B');
  });

  it('returns KB for values between 1 KB and 1 MB', () => {
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(1024 * 1024 - 1)).toBe('1024.0 KB');
  });

  it('returns MB for values at or above 1 MB', () => {
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
    expect(formatBytes(2621440)).toBe('2.5 MB');
    expect(formatBytes(10 * 1024 * 1024)).toBe('10.0 MB');
  });

  it('rounds to one decimal place', () => {
    // 1025 bytes = 1.0009765625 KB → rounds to 1.0
    expect(formatBytes(1025)).toBe('1.0 KB');
    // 1126 bytes ≈ 1.099609375 KB → rounds to 1.1
    expect(formatBytes(1126)).toBe('1.1 KB');
  });
});
