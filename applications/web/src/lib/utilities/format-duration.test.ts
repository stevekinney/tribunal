import { describe, it, expect } from 'vitest';
import { formatDuration } from './format-duration';

describe('formatDuration', () => {
  it('returns "-" when start is null', () => {
    expect(formatDuration(null, '2024-01-01T12:01:30Z')).toBe('-');
  });

  it('returns "-" when end is null', () => {
    expect(formatDuration('2024-01-01T12:00:00Z', null)).toBe('-');
  });

  it('returns "-" when both are null', () => {
    expect(formatDuration(null, null)).toBe('-');
  });

  it('returns "-" for invalid start date string', () => {
    expect(formatDuration('not-a-date', '2024-01-01T12:01:30Z')).toBe('-');
  });

  it('returns "-" for invalid end date string', () => {
    expect(formatDuration('2024-01-01T12:00:00Z', 'not-a-date')).toBe('-');
  });

  it('returns "-" for negative duration (end before start)', () => {
    expect(formatDuration('2024-01-01T12:01:30Z', '2024-01-01T12:00:00Z')).toBe('-');
  });

  it('returns "0s" for zero duration', () => {
    expect(formatDuration('2024-01-01T12:00:00Z', '2024-01-01T12:00:00Z')).toBe('0s');
  });

  it('formats sub-minute durations as seconds', () => {
    expect(formatDuration('2024-01-01T12:00:00Z', '2024-01-01T12:00:45Z')).toBe('45s');
  });

  it('formats exactly 59 seconds', () => {
    expect(formatDuration('2024-01-01T12:00:00Z', '2024-01-01T12:00:59Z')).toBe('59s');
  });

  it('formats exactly 60 seconds as "1m 0s"', () => {
    expect(formatDuration('2024-01-01T12:00:00Z', '2024-01-01T12:01:00Z')).toBe('1m 0s');
  });

  it('formats minutes and seconds', () => {
    expect(formatDuration('2024-01-01T12:00:00Z', '2024-01-01T12:01:30Z')).toBe('1m 30s');
  });

  it('formats exactly 59 minutes 59 seconds', () => {
    expect(formatDuration('2024-01-01T12:00:00Z', '2024-01-01T12:59:59Z')).toBe('59m 59s');
  });

  it('formats exactly 60 minutes as "1h 0m"', () => {
    expect(formatDuration('2024-01-01T12:00:00Z', '2024-01-01T13:00:00Z')).toBe('1h 0m');
  });

  it('formats hours and minutes', () => {
    expect(formatDuration('2024-01-01T12:00:00Z', '2024-01-01T14:05:00Z')).toBe('2h 5m');
  });

  it('accepts Date objects', () => {
    const start = new Date('2024-01-01T12:00:00Z');
    const end = new Date('2024-01-01T12:03:15Z');
    expect(formatDuration(start, end)).toBe('3m 15s');
  });

  it('accepts mixed Date and string inputs', () => {
    expect(formatDuration(new Date('2024-01-01T12:00:00Z'), '2024-01-01T12:00:30Z')).toBe('30s');
  });
});
