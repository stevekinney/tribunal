import { createInstallationSyncWorkflow } from '@tribunal/github/sync/workflow';
import { githubContext } from '$lib/server/github-context';

const workflowDefinition = createInstallationSyncWorkflow(() => githubContext);

export const { installationSyncWorkflow, syncRepositories, reconcileSyncStatusOnTeardown } =
  workflowDefinition;
