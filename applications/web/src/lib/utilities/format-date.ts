/**
 * Formats a date as a coarse, day-level relative string ("today", "3d ago", "2mo ago").
 *
 * @param dateStr - ISO 8601 date string
 * @returns Relative string, '-' for an unparseable date, or a formatted date for future dates
 *
 * @example
 * formatRelativeDate('2024-06-12T12:00:00Z') // "3d ago"
 * formatRelativeDate('not-a-date')           // "-"
 */
export function formatRelativeDate(dateStr: string): string {
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return '-';

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();

  // Future dates have no "ago" form; show the calendar date instead.
  if (diffMs < 0) {
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'today';
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`;
  return `${Math.floor(diffDays / 365)}y ago`;
}

/**
 * Formats a timestamp as a human-readable relative time string.
 * Returns granular time differences (minutes, hours) for recent times.
 *
 * @param dateInput - Date object or ISO 8601 date string
 * @param options - Formatting options
 * @param options.compact - If true, omits "ago" suffix for compact display (e.g., "5m" vs "5m ago")
 * @returns Formatted relative time string
 *
 * @example
 * formatRelativeTime('2024-01-01T12:00:00Z') // "5m ago"
 * formatRelativeTime('2024-01-01T12:00:00Z', { compact: true }) // "5m"
 * formatRelativeTime(new Date()) // "just now"
 */
export function formatRelativeTime(
  dateInput: Date | string,
  options?: { compact?: boolean },
): string {
  const date = new Date(dateInput);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();

  // Handle future dates by showing the date
  if (diffMs < 0) {
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  const suffix = options?.compact ? '' : ' ago';

  if (diffMins < 1) return options?.compact ? 'now' : 'just now';
  if (diffMins < 60) return `${diffMins}m${suffix}`;
  if (diffHours < 24) return `${diffHours}h${suffix}`;
  if (diffDays < 7) return `${diffDays}d${suffix}`;

  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * Null-safe timestamp formatter that accepts Date objects or ISO strings.
 * Returns a relative time string via `formatRelativeTime`, or '-' for null/undefined values.
 * Uses time-level granularity ("5m ago", "2h ago") rather than day-level ("today")
 * for pipeline monitoring contexts where recency matters.
 *
 * @param date - Date object, ISO string, or null
 * @returns Formatted relative time string or '-'
 *
 * @example
 * formatTimestamp('2024-01-01T12:00:00Z') // '5m ago'
 * formatTimestamp(new Date()) // 'just now'
 * formatTimestamp(null) // '-'
 */
export function formatTimestamp(date: Date | string | null): string {
  if (!date) return '-';
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return '-';
  return formatRelativeTime(parsed);
}
