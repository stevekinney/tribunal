import { fail, redirect } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { getRepositoriesForUser } from '$lib/server/repositories';
import { githubContext } from '$lib/server/github-context';
import { buildRepositoryDashboard } from '@tribunal/github/dashboard/service';
import { buildDashboardSummary, type DashboardSummary } from '@tribunal/github/dashboard/summary';
import {
  pullRequestNeedsAttention,
  type RepositoryDashboardRow,
} from '@tribunal/github/dashboard/types';
import {
  getRepositoryOperatorDetails,
  listAgents,
  operatorSurfaceStates,
  parseIgnoreGlobs,
  saveRepositoryWatchSettings,
  type RepositoryOperatorDetails,
} from '$lib/server/review/operator';
import type { PageServerLoad } from './$types';
import type { Actions } from './$types';

const repositoryPageErrorMessages: Partial<Record<string, string>> = {
  github_denied: 'GitHub authorization was cancelled. Try again when you are ready.',
  github_failed: 'GitHub authorization failed. Please try again.',
  github_installation_refresh_failed:
    'GitHub App was connected, but Tribunal could not refresh repositories. Try again from Manage repository access.',
  github_oauth_not_configured:
    'GitHub OAuth is not configured. Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET, then restart the development server.',
  github_redirect_uri_not_configured:
    'GitHub OAuth redirect URI is not configured. Set GITHUB_REDIRECT_URI outside local development.',
  github_token_revoked: 'GitHub access was revoked. Reconnect your GitHub account to continue.',
};

/**
 * The Playwright/E2E harness runs against local database fixtures with a
 * placeholder GitHub App key (see `playwright.config.ts`), never a real
 * installation. Resolving a real installation Octokit for those fixture
 * repositories would attempt live outbound GitHub network calls that hang in
 * network-restricted environments. `getRepositoriesForUser` already has this
 * bypass (`getLocalRepositoriesForUser`); the dashboard build needs the same
 * guard so it degrades to honest "no installation" rows instead of stalling
 * the whole page load.
 */
function shouldSkipLiveGithubDashboardReads(): boolean {
  return env.NODE_ENV !== 'production' && env.E2E_TEST_MODE === '1' && !!env.E2E_TEST_SECRET;
}

const defaultOperatorDetails: RepositoryOperatorDetails = {
  hasSavedSettings: false,
  watched: false,
  ignoreGlobs: [],
  agents: [],
  lastRunStatus: null,
  estimatedCostLast30DaysUsd: 0,
};

/** A pull request needing attention, with its repository identity attached for cross-repository display. */
type AttentionPullRequestRow = RepositoryDashboardRow['pullRequests'][number] & {
  repositoryOwner: string;
  repositoryName: string;
};

type Agent = Awaited<ReturnType<typeof listAgents>>[number];
type Installation = Extract<
  Awaited<ReturnType<typeof getRepositoriesForUser>>,
  { ok: true }
>['installations'][number];

interface RepositoryRow {
  id: number;
  owner: string;
  name: string;
  defaultBranch: string | null;
  accountLogin: string;
  accountAvatarUrl: string | null;
  review: RepositoryOperatorDetails;
  dashboard: RepositoryDashboardRow | null;
}

/**
 * Explicit output shape for the load function. SvelteKit's generated
 * `PageData` type is derived via `ReturnType<typeof load>` against this
 * generic, so pinning it here keeps `summary`/`attentionPullRequests`
 * consistently typed (nullable/empty on the disconnected-GitHub branch)
 * across both `return` statements below.
 */
interface RepositoriesPageData {
  repositories: RepositoryRow[];
  agents: Agent[];
  installations: Installation[];
  summary: DashboardSummary | null;
  attentionPullRequests: AttentionPullRequestRow[];
  needsConnect: boolean;
  loadError: string | null;
  surfaceStates: typeof operatorSurfaceStates;
}

/**
 * Lists the repositories the logged-in user can reach through their GitHub App
 * installations, decorated with dashboard health data (default-branch CI,
 * open pull request counts, attention signals). When the user has no GitHub
 * connection at all we surface a connect prompt rather than erroring out.
 */
export const load: PageServerLoad<RepositoriesPageData> = async ({ locals, url }) => {
  const { user } = locals;
  if (!user) {
    redirect(302, '/login');
  }

  const routeError = repositoryPageErrorMessages[url.searchParams.get('error') ?? ''] ?? null;
  const result = await getRepositoriesForUser(user.id);

  if (!result.ok) {
    if (result.error === 'no_github_token' && !routeError) {
      redirect(
        302,
        `/connect/github/account?returnTo=${encodeURIComponent(url.pathname + url.search)}`,
      );
    }

    // No usable GitHub token, or GitHub was unreachable. Render the page with a
    // connect prompt instead of a hard error so the user has an obvious next step.
    return {
      repositories: [],
      agents: [],
      installations: [],
      summary: null,
      attentionPullRequests: [],
      needsConnect: result.error === 'no_github_token',
      loadError: routeError ?? (result.error === 'github_unavailable' ? result.message : null),
      surfaceStates: operatorSurfaceStates,
    };
  }

  // Every repository the user can access — the dashboard shows all of them,
  // with watch state rendered as a visible per-row toggle/filter rather than
  // silently narrowing the table to watched repositories only.
  const repositoryIds = result.repositories.map((entry) => entry.repository.id);
  const skipLiveGithubReads = shouldSkipLiveGithubDashboardReads();
  const [operatorDetails, agents, dashboardRows] = await Promise.all([
    getRepositoryOperatorDetails(user.id, repositoryIds),
    listAgents(user.id),
    buildRepositoryDashboard(
      githubContext,
      result.repositories.map((entry) => ({
        id: entry.repository.id,
        owner: entry.repository.owner,
        name: entry.repository.name,
        defaultBranch: entry.repository.defaultBranch,
        commit: entry.repository.commit,
        installationId: skipLiveGithubReads ? null : entry.installation.installationId,
        htmlUrl: `https://github.com/${entry.repository.owner}/${entry.repository.name}`,
      })),
    ),
  ]);

  const dashboardRowsById = new Map<number, RepositoryDashboardRow>(
    dashboardRows.map((row) => [row.repository.id, row]),
  );

  const attentionPullRequests: AttentionPullRequestRow[] = dashboardRows
    .flatMap((row) =>
      row.pullRequests.filter(pullRequestNeedsAttention).map((pullRequest) => ({
        ...pullRequest,
        repositoryOwner: row.repository.owner,
        repositoryName: row.repository.name,
      })),
    )
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));

  return {
    repositories: result.repositories.map((entry) => ({
      id: entry.repository.id,
      owner: entry.repository.owner,
      name: entry.repository.name,
      defaultBranch: entry.repository.defaultBranch,
      accountLogin: entry.installation.accountLogin,
      accountAvatarUrl: entry.installation.accountAvatarUrl,
      review: operatorDetails.get(entry.repository.id) ?? defaultOperatorDetails,
      dashboard: dashboardRowsById.get(entry.repository.id) ?? null,
    })),
    agents,
    installations: result.installations,
    summary: buildDashboardSummary(dashboardRows),
    attentionPullRequests,
    needsConnect: false,
    loadError: routeError,
    surfaceStates: operatorSurfaceStates,
  };
};

export const actions: Actions = {
  watch: async ({ locals, request }) => {
    const { user } = locals;
    if (!user) redirect(302, '/login');

    const formData = await request.formData();
    const repositoryId = Number(formData.get('repositoryId'));
    if (!Number.isInteger(repositoryId) || repositoryId <= 0) {
      return fail(400, { error: 'Repository is invalid.' });
    }

    const submittedAgentIds = formData.getAll('agentIds').map(String);
    let ignoreGlobs = parseIgnoreGlobs(String(formData.get('ignoreGlobs') ?? ''));
    let agentIds = submittedAgentIds;

    if (!formData.has('ignoreGlobs') && submittedAgentIds.length === 0) {
      const currentDetails = (await getRepositoryOperatorDetails(user.id, [repositoryId])).get(
        repositoryId,
      );

      if (currentDetails?.hasSavedSettings) {
        ignoreGlobs = currentDetails.ignoreGlobs;
        agentIds = currentDetails.agents.map((agent) => agent.id);
      } else {
        const agents = await listAgents(user.id);
        agentIds = agents.filter((agent) => agent.enabled).map((agent) => agent.id);
      }
    }

    return saveRepositoryWatchSettings(user.id, {
      repositoryId,
      watched: formData.get('watched') === 'on',
      ignoreGlobs,
      agentIds,
    });
  },
};
