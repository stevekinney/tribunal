/**
 * Type definitions for GitHub sync enqueue functions.
 */

export interface EnqueueInstallationSyncOptions {
  installationId: number;
  reason: string;
  workspaceId?: number;
  triggeredByUserId?: number;
  /**
   * Stable identifier for this enqueue, used as the Weft `signalId` so retries
   * and GitHub redeliveries of the same logical event coalesce to one signal
   * rather than re-running the sync. Webhook-originated callers should pass the
   * GitHub delivery GUID. Omit only for genuinely distinct manual/non-retryable
   * intents, where each enqueue gets a freshly minted id.
   */
  deliveryId?: string;
}

export interface EnqueueInstallationSyncResult {
  workflowId: string;
  /**
   * Status of the enqueue operation.
   * - 'started': Workflow was started or signaled (startOrSignal doesn't distinguish)
   * - 'error': Failed to enqueue the workflow
   */
  status: 'started' | 'error';
  error?: string;
}
