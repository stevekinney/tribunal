/**
 * Shared types for GitHub webhook handlers in the typed router architecture.
 */

/**
 * Simple logger interface for webhook handlers.
 */
export interface WebhookLogger {
  debug: (message: string | object, ...args: unknown[]) => void;
  info: (message: string | object, ...args: unknown[]) => void;
  warn: (message: string | object, ...args: unknown[]) => void;
  error: (obj: object | string, message?: string) => void;
  child: (bindings: object) => WebhookLogger;
}

/**
 * Context provided to all webhook handlers.
 * Handlers receive payload + context and must throw on failure (for 500 retry).
 */
export interface WebhookContext {
  deliveryId: string;
  installationId: number;
  repositoryId: number;
  hookId?: string;
  logger: WebhookLogger;
  /** The app's public origin (from the incoming request), used to build `details_url` links. */
  origin: string;
}
