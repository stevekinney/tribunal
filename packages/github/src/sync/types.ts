/**
 * Type definitions for GitHub sync enqueue functions.
 */

export interface EnqueueInstallationSyncOptions {
  installationId: number;
  reason: string;
  workspaceId?: number;
  triggeredByUserId?: number;
}

export interface EnqueueInstallationSyncResult {
  workflowId: string;
  /**
   * Status of the enqueue operation.
   * - 'started': Workflow was started or signaled (signalWithStart doesn't distinguish)
   * - 'error': Failed to enqueue the workflow
   *
   * TODO(weft): Preserve this start-or-signal result shape when the enqueue
   * layer is backed by ../weft instead of the current log-only shim.
   */
  status: 'started' | 'error';
  error?: string;
}
