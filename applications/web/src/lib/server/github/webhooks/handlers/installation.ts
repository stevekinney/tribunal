/**
 * Installation event helpers for GitHub webhooks.
 */

/**
 * Previously resolved a workspace id for observability tagging. Workspaces
 * have been removed from the data model, so this always returns undefined.
 * Retained as a no-op to keep webhook sync callers compiling.
 */
export async function getPrimaryWorkspaceIdForInstallation(
  _installationId: number,
): Promise<number | undefined> {
  return undefined;
}
