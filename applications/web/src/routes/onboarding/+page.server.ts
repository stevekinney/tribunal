import { fail, redirect } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { getRepositoriesForUser } from '$lib/server/repositories';
import {
  getRepositoryOperatorDetails,
  getUserReviewSettings,
  listAgents,
  saveRepositoryWatchSettings,
  userOwnsRepository,
} from '$lib/server/review/operator';

/** Generous upper bound on a single onboarding selection; guards against a
 * crafted submission forcing an unbounded sequence of ownership checks + writes. */
const MAX_ONBOARDING_REPOSITORIES = 100;

/**
 * Why the repository picker cannot be shown yet. `disconnected` = no/revoked
 * GitHub token (reconnect); `unavailable` = transient GitHub outage (retry);
 * `no_installation` = healthy connection but the app is not installed (install);
 * `no_repositories` = app installed but it can access no repositories yet (grant
 * repository access). `null` connectReason means the picker is ready. Pinning
 * this union (rather than letting the literals widen to `string`) lets the page's
 * switch be exhaustively type-checked.
 */
type ConnectReason = 'disconnected' | 'unavailable' | 'no_installation' | 'no_repositories';

/**
 * Onboarding: repository selection step.
 *
 * Renders outside the (authenticated) layout so the full-screen two-panel
 * card fills the viewport without a sidebar. The route still enforces auth
 * itself and is never behind the layout's auth guard, which prevents an
 * infinite redirect loop when a new-user hook redirects here.
 */
export const load: PageServerLoad = async ({ locals }) => {
  const { user } = locals;
  if (!user) {
    redirect(302, '/login');
  }

  const result = await getRepositoriesForUser(user.id);

  // Distinguish the three failure shapes instead of collapsing them into one
  // "needs connect" flag. A revoked/expired token surfaces as a token error
  // here; showing it the "Install GitHub App" prompt (as the old single flag
  // did) was misleading — the app may already be installed and the real fix is
  // to reconnect. `github_unavailable` is transient (retry), every other token
  // error means reconnect, and a healthy connection with zero installations is
  // the genuine "install the app" case.
  if (!result.ok) {
    // Typed local (not an inline literal) so the precise union survives into the
    // generated PageData instead of widening to `string` — see ConnectReason.
    const connectReason: ConnectReason =
      result.error === 'github_unavailable' ? 'unavailable' : 'disconnected';
    return { repositories: [], installations: [], connectReason };
  }

  if (result.installations.length === 0) {
    const connectReason: ConnectReason = 'no_installation';
    return { repositories: [], installations: [], connectReason };
  }

  // App is installed but can see no repositories (none granted yet, or the local
  // sync hasn't produced rows). An empty picker with a disabled button is a
  // dead-end; prompt the user to grant repository access instead.
  if (result.repositories.length === 0) {
    const connectReason: ConnectReason = 'no_repositories';
    return { repositories: [], installations: result.installations, connectReason };
  }

  const repositoryIds = result.repositories.map((entry) => entry.repository.id);
  const operatorDetails = await getRepositoryOperatorDetails(user.id, repositoryIds);

  return {
    repositories: result.repositories.map((entry) => ({
      id: entry.repository.id,
      owner: entry.repository.owner,
      name: entry.repository.name,
      defaultBranch: entry.repository.defaultBranch,
      // Mirror the repositories page: watched state comes from operator details.
      watched: operatorDetails.get(entry.repository.id)?.watched ?? false,
    })),
    installations: result.installations,
    connectReason: null,
  };
};

export const actions: Actions = {
  /**
   * Batch-watch action: marks every submitted repository id as watched.
   *
   * Deduplicates, caps, and fully authorizes the batch BEFORE any write, so a
   * submission mixing owned and unauthorized ids is rejected without writing
   * anything — the authorization gate is all-or-nothing. The writes themselves
   * are a sequence of per-repository upserts, not one transaction (the codebase
   * has no transaction primitive over the Neon serverless driver), so an
   * exceptional mid-loop database failure can leave the already-processed
   * repositories watched. That partial state is self-healing: each write is an
   * idempotent `watched = true` upsert, so retrying the action simply converges
   * — no row is corrupted or double-counted. The skip path is a separate link to
   * /repositories, so an empty submission is rejected rather than treated as a
   * successful, no-op onboarding.
   *
   * redirect() must NOT be wrapped in try/catch or it will be swallowed.
   */
  watch: async ({ locals, request }) => {
    const { user } = locals;
    if (!user) redirect(302, '/login');

    const formData = await request.formData();
    const rawValues = formData.getAll('repositoryId');

    if (rawValues.length === 0) {
      return fail(400, { error: 'Select at least one repository to watch.' });
    }
    if (rawValues.length > MAX_ONBOARDING_REPOSITORIES) {
      return fail(400, { error: 'Too many repositories selected.' });
    }

    // Deduplicate and validate numeric shape before touching the database.
    const repositoryIds = [...new Set(rawValues.map(Number))];
    for (const repositoryId of repositoryIds) {
      if (!Number.isInteger(repositoryId) || repositoryId <= 0) {
        return fail(400, { error: 'One or more repository IDs are invalid.' });
      }
    }

    // Authorize the entire batch first; fail without writing if any id is not
    // owned. Returns a graceful 403 ActionFailure instead of a hard error page.
    for (const repositoryId of repositoryIds) {
      if (!(await userOwnsRepository(user.id, repositoryId))) {
        return fail(403, { error: 'You do not have access to one or more repositories.' });
      }
    }

    // Skip repositories that are already watched. saveRepositoryWatchSettings
    // replaces ignore globs and agent assignments wholesale, so re-watching a
    // preselected repo with onboarding's defaults would silently wipe any
    // exclusions or agent choices the user already configured for it.
    const operatorDetails = await getRepositoryOperatorDetails(user.id, repositoryIds);
    const repositoriesToWatch = repositoryIds.filter(
      (repositoryId) => !operatorDetails.get(repositoryId)?.watched,
    );

    // Ensure a user_review_settings row exists. The review-intent fanout INNER
    // JOINs user_review_settings with reviewsEnabled = true, so without this row a
    // freshly onboarded user's repositories are watched but their review intents
    // are never claimed. getUserReviewSettings upserts the schema defaults
    // (reviewsEnabled = true) without overwriting an existing row.
    await getUserReviewSettings(user.id);

    // Assign every enabled agent, mirroring the repositories page's "default to
    // all enabled agents on first watch" behaviour. Watching with an empty agent
    // list would persist a settings row that suppresses that default, leaving the
    // onboarded repository watched but unreviewed.
    const enabledAgentIds = (await listAgents(user.id))
      .filter((agent) => agent.enabled)
      .map((agent) => agent.id);

    // Every id is pre-authorized, so the internal ownership check won't throw.
    // Forward an ActionFailure if a write somehow reports one.
    for (const repositoryId of repositoriesToWatch) {
      const result = await saveRepositoryWatchSettings(user.id, {
        repositoryId,
        watched: true,
        ignoreGlobs: [],
        agentIds: enabledAgentIds,
      });
      if (!('success' in result)) {
        return result;
      }
    }

    redirect(303, '/repositories?onboarded=1');
  },
};
