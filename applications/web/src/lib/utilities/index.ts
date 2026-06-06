/**
 * Utility functions barrel export.
 * Re-exports all utilities for convenient importing via $lib/utilities.
 */

// Date formatting
export { formatRelativeDate, formatRelativeTime, formatTimestamp } from './format-date';

// Duration formatting
export { formatDuration } from './format-duration';

// String slugification
export { slugify } from './slugify';

// JSON stringification with fallbacks
export { stringify, stringifyOrNull } from './stringify';

// String truncation
export { truncate } from './truncate';
