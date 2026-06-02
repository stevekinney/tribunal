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
   * Note: signalWithStart is atomic and doesn't tell us whether it started a new
   * workflow or signaled an existing one, so we always return 'started'.
   */
  status: 'started' | 'error';
  error?: string;
}
