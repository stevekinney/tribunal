import { createApiClient, EndpointType } from '@neondatabase/api-client';
import { migrate } from 'drizzle-orm/neon-http/migrator';
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Ephemeral Neon branch for testing migrations in isolation.
 * Always cleanup in a finally block, even on test failures.
 */
export interface EphemeralBranch {
  branchId: string;
  connectionUri: string;
  cleanup: () => Promise<void>;
}

/**
 * Create an ephemeral Neon branch for migration testing.
 *
 * @param projectId - Neon project ID
 * @param parentBranch - Parent branch name or ID (defaults to 'main')
 * @param namePrefix - Branch name prefix (defaults to 'ci-migration-test')
 * @returns EphemeralBranch with connection URI and cleanup function
 *
 * @example
 * ```typescript
 * const branch = await createEphemeralBranch(projectId);
 * try {
 *   await runMigrationsOnBranch(branch.connectionUri);
 *   await validateInvariants(branch.connectionUri);
 * } finally {
 *   await branch.cleanup();
 * }
 * ```
 */
export async function createEphemeralBranch(
  projectId: string,
  parentBranch: string = process.env.NEON_PARENT_BRANCH || 'main',
  namePrefix: string = 'ci-migration-test',
): Promise<EphemeralBranch> {
  const apiKey = process.env.NEON_API_KEY;
  if (!apiKey) {
    throw new Error('NEON_API_KEY environment variable is required');
  }

  const client = createApiClient({
    apiKey,
  });

  // Resolve parent branch ID: accept either an ID (br-...) or a branch name
  const parentBranchId = parentBranch.startsWith('br-')
    ? parentBranch
    : await (async () => {
        const branchesResponse = await client.listProjectBranches({ projectId });
        const match = branchesResponse.data.branches.find((branch) => branch.name === parentBranch);
        if (!match) {
          throw new Error(`Parent branch "${parentBranch}" not found for project ${projectId}`);
        }
        return match.id;
      })();

  // Create branch with timestamp for traceability
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const branchName = `${namePrefix}-${timestamp}`;

  console.log(
    `Creating ephemeral branch: ${branchName} from parent: ${parentBranch} (id: ${parentBranchId})`,
  );

  const createResponse = await client.createProjectBranch(projectId, {
    branch: {
      name: branchName,
      parent_id: parentBranchId,
    },
    endpoints: [
      {
        type: EndpointType.ReadWrite,
        // Minimal compute for cost efficiency (0.25 CU)
        autoscaling_limit_min_cu: 0.25,
        autoscaling_limit_max_cu: 0.25,
        suspend_timeout_seconds: 0, // Disable auto-suspend for test stability
      },
    ],
  });

  const branch = createResponse.data.branch;
  const endpoint = createResponse.data.endpoints[0];

  // Wrap all post-creation logic in try-catch to ensure cleanup on any error
  try {
    if (!endpoint) {
      throw new Error('No endpoint created for branch');
    }

    // Wait for endpoint to be ready
    console.log(`Waiting for endpoint ${endpoint.id} to become active...`);
    let attempts = 0;
    const maxAttempts = 30;
    while (attempts < maxAttempts) {
      const statusResponse = await client.getProjectEndpoint(projectId, endpoint.id);
      const currentEndpoint = statusResponse.data.endpoint;

      // Check current_state instead of host, which is always present
      if (currentEndpoint.current_state === 'active') {
        // Endpoint is ready - derive full connection URI by reusing base credentials
        const baseDatabaseUrl = process.env.DATABASE_URL;
        if (!baseDatabaseUrl) {
          throw new Error('DATABASE_URL is not set; cannot construct branch connection URI');
        }

        const baseUrl = new URL(baseDatabaseUrl);
        const branchUrl = new URL(baseUrl.toString());
        branchUrl.host = currentEndpoint.host;

        const connectionUri = branchUrl.toString();
        console.log(`Branch ${branchName} is ready (endpoint: ${endpoint.id})`);

        const cleanup = async () => {
          console.log(`Cleaning up branch: ${branchName}`);
          try {
            await client.deleteProjectBranch(projectId, branch.id);
            console.log(`Branch ${branchName} deleted successfully`);
          } catch (error) {
            console.error(`Failed to delete branch ${branchName}:`, error);
            throw error;
          }
        };

        return {
          branchId: branch.id,
          connectionUri,
          cleanup,
        };
      }

      // Wait before next check
      await new Promise((resolve) => setTimeout(resolve, 2000));
      attempts++;
    }

    throw new Error(`Endpoint did not become active after ${maxAttempts} attempts`);
  } catch (error) {
    // Cleanup on any error after branch creation
    try {
      await client.deleteProjectBranch(projectId, branch.id);
      console.log(`Cleaned up branch ${branchName} after error`);
    } catch (cleanupError) {
      console.error(`Failed to cleanup branch ${branchName} after error:`, cleanupError);
    }
    throw error;
  }
}

/**
 * Run drizzle-kit migrations against an ephemeral branch.
 *
 * @param connectionUri - Database connection URI
 * @throws If migrations fail to apply
 *
 * @example
 * ```typescript
 * await runMigrationsOnBranch(branch.connectionUri);
 * ```
 */
export async function runMigrationsOnBranch(connectionUri: string): Promise<void> {
  console.log('Running migrations on ephemeral branch...');

  // Resolve migrations directory relative to this file
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const migrationsFolder = resolve(currentDir, '../../drizzle');

  console.log(`Migrations directory: ${migrationsFolder}`);

  const sql = neon(connectionUri);
  const db = drizzle({ client: sql });

  try {
    await migrate(db, { migrationsFolder });
    console.log('Migrations applied successfully');
  } catch (error) {
    console.error('Migration failed:', error);
    throw error;
  }
}
