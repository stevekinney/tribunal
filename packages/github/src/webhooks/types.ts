/**
 * Types and constants for GitHub webhook handling.
 */

/**
 * Generic webhook event type for events we receive from GitHub.
 * We use minimal interfaces for field extraction since the payload
 * is already verified via signature (came from GitHub).
 */
export type WebhookPayload = Record<string, unknown>;

/**
 * Result type for webhook handlers that may or may not handle an event.
 */
export type HandlerResult = { handled: true; response: Response } | { handled: false };

/**
 * Maximum webhook payload size (5MB).
 * GitHub allows up to 25MB but most legitimate webhooks are <100KB.
 */
export const MAX_PAYLOAD_SIZE = 5 * 1024 * 1024;
