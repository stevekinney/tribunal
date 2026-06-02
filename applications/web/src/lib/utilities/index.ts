/**
 * Utility functions barrel export.
 * Re-exports all utilities for convenient importing via $lib/utilities.
 *
 * Utilities that moved to @tribunal/components are re-exported from there
 * to maintain backward compatibility for route-level consumers.
 */

// Date formatting (from @tribunal/components)
export {
  formatRelativeDate,
  formatRelativeTime,
  formatTimestamp,
} from '@tribunal/components/utilities/format-date';

// Duration formatting (from @tribunal/components)
export { formatDuration } from '@tribunal/components/utilities/format-duration';

// String slugification
export { slugify } from './slugify';

// JSON stringification with fallbacks (from @tribunal/components)
export { stringify, stringifyOrNull } from '@tribunal/components/utilities/stringify';

// String truncation (from @tribunal/components)
export { truncate } from '@tribunal/components/utilities/truncate';
