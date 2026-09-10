/**
 * Decouples the resource-update *producer* (the review layer, which mutates run
 * state in the web process) from the MCP mount that owns the per-user handler
 * cache (constructed at module scope in `hooks.server.ts`). Importing the mount
 * into the review layer would pull `hooks.server.ts`'s startup side effects into
 * unrelated code and risk an import cycle; instead the mount registers its
 * publisher here once, and producers call `notifyReviewRunsChanged`.
 *
 * When the MCP surface is disabled (no mount) nothing is registered and the
 * notifier is a no-op, so the review layer never needs to know whether MCP is on.
 * Delivery is best-effort by design: `publishUserResourceUpdate` is itself a
 * no-op when the user holds no live subscription, so an un-subscribed user's
 * run change simply notifies nobody (TRI-126).
 */

/** The single subscribable resource Tribunal exposes today (TRI-126). */
export const REVIEW_RUNS_RESOURCE_URI = 'tribunal://review-runs';

type ResourceUpdatePublisher = (userId: string, uri: string) => void;

let publisher: ResourceUpdatePublisher | null = null;

/** Registers the mount's publisher. Called once when the MCP mount is constructed. */
export function registerResourceUpdatePublisher(publish: ResourceUpdatePublisher): void {
  publisher = publish;
}

/** Clears the registered publisher (mount disposal / test teardown). */
export function clearResourceUpdatePublisher(): void {
  publisher = null;
}

/**
 * Announces that `userId`'s review-run collection changed, so a live MCP
 * subscriber sees `notifications/resources/updated`. No-op when MCP is disabled
 * or the user has no subscription.
 */
export function notifyReviewRunsChanged(userId: number): void {
  // Contained by design: this fires inline from primary review mutations (e.g.
  // operator.stopRun), so a publisher fault must never surface as a failure of
  // the mutation that triggered it. Log and swallow — a missed resource-update
  // notification is not worth failing a cancellation over.
  try {
    publisher?.(String(userId), REVIEW_RUNS_RESOURCE_URI);
  } catch (error) {
    console.error('[mcp] resource-update notification failed', error);
  }
}
