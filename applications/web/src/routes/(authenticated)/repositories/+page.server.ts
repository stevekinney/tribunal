import { fail, redirect } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { getRepositoriesForUser } from '$lib/server/repositories';
import { githubContext } from '$lib/server/github-context';
import { buildRepositoryDashboard, unavailableRow } from '@tribunal/github/dashboard/service';
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
  setRepositoryWatched,
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
}

/**
 * A repository the user can access but has not added to Tribunal yet. Carries
 * only identity fields — the "Add repository" picker needs to list and label
 * these, but they intentionally get no dashboard fan-out until they are added.
 */
interface AddableRepository {
  id: number;
  owner: string;
  name: string;
  defaultBranch: string | null;
}

/**
 * Explicit output shape for the load function. SvelteKit's generated
 * `PageData` type is derived via `ReturnType<typeof load>` against this
 * generic, so pinning it here keeps `summary`/`attentionPullRequests`/
 * `dashboardRowsById` consistently typed (nullable/empty on the
 * disconnected-GitHub branch) across both `return` statements below.
 *
 * `summary`, `attentionPullRequests`, and `dashboardRowsById` are Promises,
 * not resolved values: they carry every GitHub-dependent field on this page,
 * and returning them un-awaited is what lets SvelteKit stream them to the
 * client instead of blocking the whole `load` (and, transitively, the
 * post-login `goto()` on the auth callback page) on the repository dashboard
 * fan-out. `repositories`/`addableRepositories`/`agents`/`installations` stay
 * synchronous because they only ever depend on the database.
 */
interface RepositoriesPageData {
  repositories: RepositoryRow[];
  addableRepositories: AddableRepository[];
  agents: Agent[];
  installations: Installation[];
  summary: Promise<DashboardSummary | null>;
  attentionPullRequests: Promise<AttentionPullRequestRow[]>;
  dashboardRowsById: Promise<Map<number, RepositoryDashboardRow>>;
  needsConnect: boolean;
  loadError: string | null;
  surfaceStates: typeof operatorSurfaceStates;
}

/**
 * Lists the repositories the logged-in user has added to Tribunal (watched),
 * decorated with dashboard health data (default-branch CI, open pull request
 * counts, attention signals). The full accessible set is enumerated only to
 * populate the "Add repository" picker; it never drives a per-repository
 * GitHub fan-out, so the page stays fast regardless of how many repositories
 * the installation can reach. When the user has no GitHub connection at all we
 * surface a connect prompt rather than erroring out.
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
      addableRepositories: [],
      agents: [],
      installations: [],
      summary: Promise.resolve(null),
      attentionPullRequests: Promise.resolve([]),
      dashboardRowsById: Promise.resolve(new Map()),
      needsConnect: result.error === 'no_github_token',
      loadError: routeError ?? (result.error === 'github_unavailable' ? result.message : null),
      surfaceStates: operatorSurfaceStates,
    };
  }

  const repositoryIds = result.repositories.map((entry) => entry.repository.id);
  const skipLiveGithubReads = shouldSkipLiveGithubDashboardReads();

  const [operatorDetails, agents] = await Promise.all([
    getRepositoryOperatorDetails(user.id, repositoryIds),
    listAgents(user.id),
  ]);

  // The main table shows only repositories explicitly added to Tribunal
  // (watched). Everything else the installation can reach stays out of the
  // table and feeds the "Add repository" picker instead. Scoping the dashboard
  // fan-out to added repositories keeps the GitHub work proportional to what
  // the user is actually reviewing — not to the full accessible catalog, which
  // could be hundreds of repositories and blow past the shared API budget.
  const addedRepositories = result.repositories.filter(
    (entry) => operatorDetails.get(entry.repository.id)?.watched,
  );
  const addableRepositories: AddableRepository[] = result.repositories
    .filter((entry) => !operatorDetails.get(entry.repository.id)?.watched)
    .map((entry) => ({
      id: entry.repository.id,
      owner: entry.repository.owner,
      name: entry.repository.name,
      defaultBranch: entry.repository.defaultBranch,
    }));

  // Kick off the GitHub-backed dashboard fan-out but deliberately do not
  // `await` it here. `load` returning before this settles is the entire
  // point: SvelteKit streams promises returned from `load` to the client, so
  // the page shell (repository identity, search, watch toggles) paints
  // immediately, and a client-side `goto()` to this route (as happens right
  // after sign-in) resolves as soon as `load` returns rather than once every
  // repository's live GitHub calls finish.
  //
  // The `.catch()` is load-bearing, not defensive dressing: nothing awaits
  // this promise inside `load` anymore, so a rejection (e.g. the DB read
  // inside `listPRStatesForRepositories`) would otherwise surface as an
  // unhandled server-side promise rejection instead of a rendered fallback.
  //
  // Degrading to an empty array here would be misleading: the summary strip
  // would report zero repositories (not "unknown"), and the per-row
  // "Unknown" banner only checks for `dataStatus === 'unavailable'` rows, so
  // a completely empty result would render as if nothing needed a refresh
  // rather than as a failure. Building an `unavailableRow` per added
  // repository reuses the exact fallback shape the UI already renders when a
  // single repository's own dashboard build fails — see `+page.svelte`.
  const dashboardRowsPromise: Promise<RepositoryDashboardRow[]> = buildRepositoryDashboard(
    githubContext,
    addedRepositories.map((entry) => ({
      id: entry.repository.id,
      owner: entry.repository.owner,
      name: entry.repository.name,
      defaultBranch: entry.repository.defaultBranch,
      commit: entry.repository.commit,
      installationId: skipLiveGithubReads ? null : entry.installation.installationId,
      htmlUrl: `https://github.com/${entry.repository.owner}/${entry.repository.name}`,
    })),
  ).catch((error) => {
    console.error('Failed to build repository dashboard', error);
    const refreshedAt = new Date().toISOString();
    return addedRepositories.map((entry) =>
      unavailableRow(
        {
          id: entry.repository.id,
          owner: entry.repository.owner,
          name: entry.repository.name,
          defaultBranch: entry.repository.defaultBranch,
          htmlUrl: `https://github.com/${entry.repository.owner}/${entry.repository.name}`,
        },
        refreshedAt,
        // Deliberately unattributed. This catch covers the *whole* fan-out
        // rejecting, which includes non-GitHub causes — `listPRStatesForRepositories`
        // throwing because the database is unavailable reaches here too. Naming
        // `github-error` would tell the user GitHub failed when its reads may
        // have succeeded. The undefined fallback says the data could not be
        // refreshed without asserting a cause we do not know.
        undefined,
      ),
    );
  });

  const dashboardRowsById = dashboardRowsPromise.then(
    (rows) => new Map(rows.map((row) => [row.repository.id, row])),
  );

  const attentionPullRequests = dashboardRowsPromise.then((rows) =>
    rows
      .flatMap((row) =>
        row.pullRequests.filter(pullRequestNeedsAttention).map((pullRequest) => ({
          ...pullRequest,
          repositoryOwner: row.repository.owner,
          repositoryName: row.repository.name,
        })),
      )
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0)),
  );

  const summary = dashboardRowsPromise.then((rows) => buildDashboardSummary(rows));

  return {
    repositories: addedRepositories.map((entry) => ({
      id: entry.repository.id,
      owner: entry.repository.owner,
      name: entry.repository.name,
      defaultBranch: entry.repository.defaultBranch,
      accountLogin: entry.installation.accountLogin,
      accountAvatarUrl: entry.installation.accountAvatarUrl,
      review: operatorDetails.get(entry.repository.id) ?? defaultOperatorDetails,
    })),
    addableRepositories,
    agents,
    installations: result.installations,
    summary,
    attentionPullRequests,
    dashboardRowsById,
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

    const watched = formData.get('watched') === 'on';
    const submittedAgentIds = formData.getAll('agentIds').map(String);

    // Unwatching submits no configuration at all (see the settings page's
    // danger-zone form). Flip just that column rather than reading the current
    // settings and writing them back: a read-then-rewrite loses anything
    // another tab saves in between, which is the whole reason the form stopped
    // sending its own snapshot.
    if (!watched && !formData.has('ignoreGlobs') && submittedAgentIds.length === 0) {
      await setRepositoryWatched(user.id, repositoryId, false);
      // `redirect` throws, so nothing after this runs. The result object is
      // deliberately dropped: this path is only ever reached by the settings
      // page's plain, non-enhanced form, which has no JavaScript to read a
      // JSON body and needs the 303 to land on a clean GET instead.
      redirect(303, '/repositories');
    }

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

    const result = await saveRepositoryWatchSettings(user.id, {
      repositoryId,
      watched,
      ignoreGlobs,
      agentIds,
    });

    // Turning watching off is submitted only by the repository settings
    // page's plain, non-enhanced "Stop watching" form (see
    // settings/+page.svelte) — a real cross-document POST with no JS to act
    // on a JSON result. Without an explicit redirect here, the browser would
    // be left sitting on the POST response for `/repositories?/watch`:
    // reloading or revisiting that history entry prompts a resubmission
    // confirmation, and confirming it would unwatch again (or overwrite a
    // meanwhile-changed configuration) against whatever the repository looks
    // like by then. Redirecting to a clean GET on success avoids that and
    // lands the user on the list that now reflects the change. The
    // Add-repository form on this page always submits `watched=on` and
    // handles the result itself via `use:enhance`, so this redirect never
    // fires for that flow.
    if (!watched && !('status' in result)) {
      redirect(303, '/repositories');
    }

    return result;
  },
};
