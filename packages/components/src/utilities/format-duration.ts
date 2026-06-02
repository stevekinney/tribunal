/**
 * Formats the duration between two timestamps as a human-readable string.
 *
 * @param start - Start timestamp (Date or ISO string), or null
 * @param end - End timestamp (Date or ISO string), or null
 * @returns Formatted duration string (e.g., "45s", "3m 12s", "2h 15m") or "-" if inputs are invalid
 *
 * @example
 * formatDuration('2024-01-01T12:00:00Z', '2024-01-01T12:01:30Z') // '1m 30s'
 * formatDuration('2024-01-01T12:00:00Z', '2024-01-01T14:05:00Z') // '2h 5m'
 * formatDuration(null, null) // '-'
 */
export function formatDuration(start: Date | string | null, end: Date | string | null): string {
  if (!start || !end) return '-';
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return '-';
  const diffMs = endMs - startMs;
  if (diffMs < 0) return '-';
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}
