import { describe, it, expect } from 'vitest';
import { formatDuration } from './format-duration';

describe('formatDuration', () => {
  it('returns dash for null start', () => {
    expect(formatDuration(null, '2024-01-01T12:01:00Z')).toBe('-');
  });

  it('returns dash for null end', () => {
    expect(formatDuration('2024-01-01T12:00:00Z', null)).toBe('-');
  });

  it('returns dash for both null', () => {
    expect(formatDuration(null, null)).toBe('-');
  });

  it('returns dash for negative duration', () => {
    expect(formatDuration('2024-01-01T12:01:00Z', '2024-01-01T12:00:00Z')).toBe('-');
  });

  it('returns 0s for zero duration', () => {
    expect(formatDuration('2024-01-01T12:00:00Z', '2024-01-01T12:00:00Z')).toBe('0s');
  });

  it('formats seconds only', () => {
    expect(formatDuration('2024-01-01T12:00:00Z', '2024-01-01T12:00:45Z')).toBe('45s');
  });

  it('formats minutes and seconds', () => {
    expect(formatDuration('2024-01-01T12:00:00Z', '2024-01-01T12:03:12Z')).toBe('3m 12s');
  });

  it('formats exact minutes with zero seconds', () => {
    expect(formatDuration('2024-01-01T12:00:00Z', '2024-01-01T12:05:00Z')).toBe('5m 0s');
  });

  it('formats hours and minutes', () => {
    expect(formatDuration('2024-01-01T12:00:00Z', '2024-01-01T14:15:00Z')).toBe('2h 15m');
  });

  it('accepts Date objects', () => {
    const start = new Date('2024-01-01T12:00:00Z');
    const end = new Date('2024-01-01T12:02:30Z');
    expect(formatDuration(start, end)).toBe('2m 30s');
  });

  it('accepts mixed Date and string inputs', () => {
    const start = new Date('2024-01-01T12:00:00Z');
    expect(formatDuration(start, '2024-01-01T12:00:10Z')).toBe('10s');
  });
});
