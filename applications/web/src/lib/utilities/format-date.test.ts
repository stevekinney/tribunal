import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { formatRelativeDate, formatRelativeTime, formatTimestamp } from './format-date';

const FIXED_NOW = new Date('2024-06-15T12:00:00Z');

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('formatRelativeDate', () => {
  it('returns "today" for same day', () => {
    expect(formatRelativeDate('2024-06-15T08:00:00Z')).toBe('today');
  });

  it('returns "yesterday" for 1 day ago', () => {
    expect(formatRelativeDate('2024-06-14T08:00:00Z')).toBe('yesterday');
  });

  it('returns "Xd ago" for within a week', () => {
    expect(formatRelativeDate('2024-06-12T12:00:00Z')).toBe('3d ago');
  });

  it('returns "Xw ago" for within a month', () => {
    expect(formatRelativeDate('2024-05-25T12:00:00Z')).toBe('3w ago');
  });

  it('returns "Xmo ago" for within a year', () => {
    expect(formatRelativeDate('2024-01-15T12:00:00Z')).toBe('5mo ago');
  });

  it('returns "Xy ago" for one year or more', () => {
    expect(formatRelativeDate('2023-06-15T12:00:00Z')).toBe('1y ago');
  });
});

describe('formatRelativeTime', () => {
  it('returns "just now" for under 1 minute', () => {
    expect(formatRelativeTime('2024-06-15T11:59:30Z')).toBe('just now');
  });

  it('returns "now" in compact mode for under 1 minute', () => {
    expect(formatRelativeTime('2024-06-15T11:59:30Z', { compact: true })).toBe('now');
  });

  it('returns minutes ago', () => {
    expect(formatRelativeTime('2024-06-15T11:55:00Z')).toBe('5m ago');
  });

  it('omits "ago" suffix in compact mode', () => {
    expect(formatRelativeTime('2024-06-15T11:55:00Z', { compact: true })).toBe('5m');
  });

  it('returns hours ago', () => {
    expect(formatRelativeTime('2024-06-15T09:00:00Z')).toBe('3h ago');
  });

  it('returns days ago', () => {
    expect(formatRelativeTime('2024-06-13T12:00:00Z')).toBe('2d ago');
  });

  it('returns a formatted date string for more than 7 days ago', () => {
    const result = formatRelativeTime('2024-06-01T12:00:00Z');
    // Locale-dependent; assert it's not one of the short-form results
    expect(result).not.toMatch(/ago|now/);
    expect(result.length).toBeGreaterThan(2);
  });

  it('returns a formatted date string for future dates', () => {
    const result = formatRelativeTime('2024-06-20T12:00:00Z');
    expect(result).not.toMatch(/ago|now/);
    expect(result.length).toBeGreaterThan(2);
  });

  it('accepts a Date object', () => {
    expect(formatRelativeTime(new Date('2024-06-15T11:55:00Z'))).toBe('5m ago');
  });
});

describe('formatTimestamp', () => {
  it('returns "-" for null', () => {
    expect(formatTimestamp(null)).toBe('-');
  });

  it('returns "-" for an invalid date string', () => {
    expect(formatTimestamp('not-a-date')).toBe('-');
  });

  it('formats a valid ISO string via formatRelativeTime', () => {
    expect(formatTimestamp('2024-06-15T11:55:00Z')).toBe('5m ago');
  });

  it('accepts a Date object', () => {
    expect(formatTimestamp(new Date('2024-06-15T11:55:00Z'))).toBe('5m ago');
  });
});
