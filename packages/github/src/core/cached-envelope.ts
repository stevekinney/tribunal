/**
 * Cached envelope: metadata wrapper for GitHub API responses stored in Redis.
 *
 * Each cached value is wrapped in an envelope that carries:
 * - The value itself
 * - An optional eTag for conditional requests (If-None-Match)
 * - Timing metadata for TTL enforcement and observability
 * - A source discriminant for logging/debugging
 */

// ============================================================================
// Types
// ============================================================================

/** Source of the cached value, used for logging and observability. */
export type CachedEnvelopeSource = 'cache' | 'api' | 'conditional';

/**
 * Envelope that wraps a cached GitHub API response with metadata.
 *
 * Stored as JSON in Redis. The generic parameter `T` is the shape
 * of the GitHub API response after transformation.
 */
export interface CachedEnvelope<T> {
  /** The cached value (transformed GitHub API response). */
  value: T;

  /** GitHub eTag header from the response, if available. */
  etag?: string;

  /** Unix timestamp (ms) when the value was fetched from GitHub. */
  fetchedAt: number;

  /** Unix timestamp (ms) when this envelope expires. */
  expiresAt: number;

  /** How this envelope was populated. */
  source: CachedEnvelopeSource;
}
