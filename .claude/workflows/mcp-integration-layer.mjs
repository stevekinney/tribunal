export const meta = {
  name: 'mcp-integration-layer',
  description:
    'Drive one opened layer of the Tribunal MCP integration graph: implement each issue, adversarially verify it, push a branch',
  whenToUse:
    'After a layer of the TRI MCP graph opens. Pass args.issues (see the descriptor contract below); the orchestrator drives pull request gates and Linear separately.',
  phases: [
    { title: 'Execute', detail: 'one agent per issue: implement or draft the decision, then push a branch' },
    { title: 'Verify', detail: 'adversarial pass: does each acceptance criterion actually hold?' },
  ],
};

// ---------------------------------------------------------------------------
// Argument contract
//
// args.issues: array of descriptors. Every field is required — passing a bare
// Linear issue object silently routes a decision through implementation mode
// and substitutes `undefined` into branch commands, so the shape is validated
// up front rather than failing halfway through a layer.
//
//   id      string   Linear identifier, e.g. 'TRI-27'
//   title   string   issue title
//   body    string   the issue text, verbatim — agents do not fetch it
//   branch  string   branch to create or reopen, e.g. 'steve/tri-27-mcp-package'
//   mode    'implement' | 'decide'
//   model   'opus' | 'sonnet' | 'haiku'
//   effort  'low' | 'medium' | 'high' | 'xhigh' | 'max'
//
// args.repositoryPath: optional. Only used to name the orchestrator's checkout
// in the do-not-touch warning. The prohibition is written path-independently,
// so omitting it costs nothing.
// ---------------------------------------------------------------------------

// Branch names are interpolated directly into the shell commands the agent is
// told to run, so the contract restricts them to characters that cannot change
// a command's structure. `git check-ref-format` accepts far more than this —
// `feature/foo;echo` is a valid ref name — and a ref containing `;`, `$`, or a
// backtick would be parsed as multiple shell operations rather than one
// argument. Narrowing the contract is simpler and safer than quoting every
// interpolation site correctly and hoping none is added later unquoted.
const SHELL_SAFE_BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

const VALID_MODES = ['implement', 'decide'];
const VALID_MODELS = ['opus', 'sonnet', 'haiku'];
const VALID_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];

function validateIssues(rawIssues) {
  const problems = [];
  rawIssues.forEach((issue, index) => {
    const where = `issues[${index}]${issue && issue.id ? ` (${issue.id})` : ''}`;
    if (!issue || typeof issue !== 'object') {
      problems.push(`${where}: not an object`);
      return;
    }
    for (const field of ['id', 'title', 'body', 'branch']) {
      if (typeof issue[field] !== 'string' || issue[field].length === 0) {
        problems.push(`${where}: missing or empty "${field}"`);
      }
    }
    if (typeof issue.branch === 'string' && issue.branch.length > 0 && !SHELL_SAFE_BRANCH.test(issue.branch)) {
      problems.push(
        `${where}: branch "${issue.branch}" is not shell-safe. It is interpolated into shell commands, so it must match ${SHELL_SAFE_BRANCH}.`,
      );
    }
    if (!VALID_MODES.includes(issue.mode)) {
      problems.push(`${where}: mode must be one of ${VALID_MODES.join(', ')} (got ${JSON.stringify(issue.mode)})`);
    }
    if (!VALID_MODELS.includes(issue.model)) {
      problems.push(`${where}: model must be one of ${VALID_MODELS.join(', ')} (got ${JSON.stringify(issue.model)})`);
    }
    if (!VALID_EFFORTS.includes(issue.effort)) {
      problems.push(`${where}: effort must be one of ${VALID_EFFORTS.join(', ')} (got ${JSON.stringify(issue.effort)})`);
    }
  });
  return problems;
}

// Non-negotiables every agent inherits. These trace to two failure classes this
// codebase has actually shipped: a test suite passing while the fix is absent,
// and configuration added to a schema but never wired into its enforcing gate.
function houseRules(issue, orchestratorCheckout) {
  const checkoutName = orchestratorCheckout
    ? `the orchestrator's checkout (\`${orchestratorCheckout}\`)`
    : "the orchestrator's own checkout of this repository";

  return `
## Repository

You are already inside your OWN private git worktree of the Tribunal repository:
a complete checkout, safe to edit. Work there and only there.

Never leave it for ${checkoutName}, whatever its path. Switching branches inside
that checkout corrupts work in progress, and two agents doing it concurrently
would each silently operate on a mixture of two branches.

## Non-negotiable discipline

- Use \`bun\`, never npm/yarn/pnpm. Run scripts with \`bun run <script>\`.
- Check pass/fail by EXIT CODE, never by grepping output. Tool output carries ANSI
  escapes, so \`grep -c "error TS"\` can report zero against output that plainly
  contains errors. Beware pipelines too: \`cmd | tail\` reports tail's status, not
  cmd's. Use \`cmd > /dev/null 2>&1; echo $?\`.
- NEVER use \`--no-verify\`, \`HUSKY=0\`, or \`CI=1\` to get past a hook.
- NEVER raise a timeout, retry count, or resource limit to turn a check green.
- NEVER skip a test, comment out an assertion, or leave a TODO in place of a fix.
  If the issue as scoped cannot be finished, say so in your report instead of
  shipping a partial dressed up as complete.
- Test runner is vitest. No \`bun:test\` may enter this repository.
- Prefer full words in names: \`configuration\` not \`config\`, \`utilities\` not \`utils\`.
- Kebab-case filenames. **Source code** is TypeScript only (\`.ts\`/\`.tsx\`) — never
  introduce \`.js\`, \`.mjs\`, \`.cjs\`, or \`.jsx\` source. This restriction is about
  source files: documentation, decision documents, and learnings are Markdown
  (\`.md\`) as they are everywhere else in this repository.
- Match existing repository conventions. Inspect neighbouring files before
  inventing a new pattern or directory.
- Cite code by file and symbol, never by line number — line references drift.
- Markdown: em dashes tight (no spaces), no horizontal rules, no numbered
  headings, no bold inside headings, cap heading depth at three levels.

## Your deliverable

Work on branch \`${issue.branch}\`, created from \`main\` — or reopened, if a previous
run already pushed it:

    git fetch origin main
    git fetch origin ${issue.branch} || true
    git switch -c ${issue.branch} origin/${issue.branch} 2>/dev/null \\
      || git switch ${issue.branch} 2>/dev/null \\
      || git switch -c ${issue.branch} origin/main

The first form reopens a branch a previous run pushed, so a retry after a
\`needs-rework\` verdict amends that work instead of failing on \`-c\`. The last
form creates it fresh. Confirm which case you landed in before assuming the
tree is empty.

Commit and push with \`git push -u origin ${issue.branch}\`.

Do NOT open a pull request — the orchestrator does that. Do NOT touch Linear:
moving a ticket is the orchestrator's job, per the carve-out recorded in
\`.claude/skills/execute-plan/SKILL.md\`. Never commit directly to \`main\`.

Return a report: what you changed, the exact verification commands you ran with
their real exit codes, and any acceptance criterion you could NOT satisfy.
`;
}

const REPORT_SCHEMA = {
  type: 'object',
  required: ['issue', 'pushed', 'branch', 'filesChanged', 'verification', 'unmetCriteria', 'notes'],
  properties: {
    issue: { type: 'string' },
    pushed: { type: 'boolean', description: 'true only if the branch was actually pushed to origin' },
    branch: { type: 'string' },
    filesChanged: { type: 'array', items: { type: 'string' } },
    verification: {
      type: 'array',
      description: 'Every command run, with its real exit code',
      items: {
        type: 'object',
        required: ['command', 'exitCode'],
        properties: { command: { type: 'string' }, exitCode: { type: 'number' } },
      },
    },
    unmetCriteria: {
      type: 'array',
      description: 'Acceptance criteria NOT satisfied. Empty only if every one is met.',
      items: { type: 'string' },
    },
    notes: { type: 'string' },
  },
};

const VERDICT_SCHEMA = {
  type: 'object',
  required: ['issue', 'criteriaVerified', 'confirmedMet', 'problems', 'recommendation'],
  properties: {
    issue: { type: 'string' },
    criteriaVerified: {
      type: 'array',
      description: 'One entry per numbered acceptance criterion in the issue',
      items: {
        type: 'object',
        required: ['criterion', 'met', 'evidence'],
        properties: {
          criterion: { type: 'string' },
          met: { type: 'boolean' },
          evidence: { type: 'string', description: 'The command run and its exit code, or the file and symbol inspected' },
        },
      },
    },
    confirmedMet: { type: 'boolean', description: 'true only if EVERY numbered criterion is met' },
    problems: {
      type: 'array',
      description:
        'Anything wrong, including problems outside the numbered criteria (out-of-scope changes, fabricated citations, weakened tests). Set recommendation to needs-rework if any of these should block a pull request.',
      items: { type: 'string' },
    },
    recommendation: { type: 'string', enum: ['open-pull-request', 'needs-rework', 'hand-back-to-human'] },
  },
};

// Known limitation: there is no per-agent deadline. A stage that never resolves
// because of a model, network, or tool hang leaves `await pipeline(...)` waiting
// indefinitely, and the layer returns no verdicts at all. This is not fixable
// from inside the script — `agent()` exposes no timeout option, and the script
// sandbox has no clock (`Date.now()` throws by design, so resume stays
// deterministic), so there is nothing to build a deadline out of. The mitigation
// is external: the run is visible in `/workflows` and can be ended with
// TaskStop, after which the orchestrator re-dispatches. Stated here so a reader
// does not assume the rework path covers a hang; it covers a failure, which is
// a different thing.
const rawIssues = args && args.issues;

if (rawIssues !== undefined && rawIssues !== null && !Array.isArray(rawIssues)) {
  // Without this branch a malformed value fails in two different silent ways:
  // an object or number lacks `length` and reads as "nothing to do", while a
  // non-empty string reaches validateIssues and throws on `.forEach`.
  const problem = `args.issues must be an array of issue descriptors, got ${typeof rawIssues}.`;
  log(`Refusing to start: ${problem}`);
  return { ready: [], rework: [], all: [], invalid: [problem] };
}

if (!rawIssues || rawIssues.length === 0) {
  log('No issues passed in args.issues — nothing to do.');
  return { ready: [], rework: [], all: [], invalid: [] };
}

const contractProblems = validateIssues(rawIssues);
if (contractProblems.length) {
  log(`Refusing to start: ${contractProblems.length} issue descriptor problem(s).`);
  for (const problem of contractProblems) log(`  ${problem}`);
  return { ready: [], rework: [], all: [], invalid: contractProblems };
}

const orchestratorCheckout = (args && args.repositoryPath) || null;
const issues = rawIssues;

log(`Layer opened with ${issues.length} issue(s): ${issues.map((i) => i.id).join(', ')}`);

const results = await pipeline(
  issues,

  // Stage 1 — implement, or draft the decision. One agent per issue, isolated.
  (issue) => {
    const decisionFraming = `
## This is a DECISION issue — draft, do not self-approve

Your job is to produce a decision document (Markdown) that a human approves:

- Lay out the genuine options with their trade-offs.
- Make a clear recommendation and say why.
- Mark anything you could not resolve from the codebase as an OPEN QUESTION
  rather than quietly picking an answer.
- Do NOT write it as though the decision is already settled, and do NOT claim
  approval. The human checkpoint is the point of this issue.

Ground every claim in the actual codebase, and cite only sources you have read.
A citation that turns out not to say what you claim is worse than no citation,
because it reads as diligence.`;

    const implementationFraming = `
## This is an IMPLEMENTATION issue

For every acceptance criterion, prove it holds by running something that exits
non-zero when it does not. If a criterion asks you to demonstrate a guard fails
when removed, actually remove it, capture the failing run, RESTORE it, and
record both exit codes — that demonstration is a deliverable, not a formality.

Any verification script the issue names must be added to the root
\`package.json\`. Do not edit or compose aggregate scripts (\`test:security\`,
\`test:observability\`, \`test:mcp\`) — a different issue owns those.`;

    return agent(
      `You are executing Linear issue ${issue.id} for the Tribunal MCP server integration.

# The issue, verbatim

## ${issue.id}: ${issue.title}

${issue.body}

${issue.mode === 'decide' ? decisionFraming : implementationFraming}

${houseRules(issue, orchestratorCheckout)}

Start by reading the repository to understand its real shape — do not assume.
Then do the work. Then verify. Then commit and push.`,
      {
        label: `${issue.mode === 'decide' ? 'draft' : 'build'}:${issue.id}`,
        phase: 'Execute',
        model: issue.model,
        effort: issue.effort,
        isolation: 'worktree',
        schema: REPORT_SCHEMA,
      },
    );
  },

  // Stage 2 — adversarial verify. Fresh eyes, told to disprove the report.
  (report, issue) => {
    if (!report) {
      return {
        issue: issue.id,
        criteriaVerified: [],
        confirmedMet: false,
        problems: ['Stage 1 agent produced no report (died, errored, or was skipped).'],
        recommendation: 'needs-rework',
      };
    }
    if (!report.pushed) {
      return {
        issue: issue.id,
        criteriaVerified: [],
        confirmedMet: false,
        problems: [`Branch ${issue.branch} was not pushed. Notes: ${report.notes}`],
        recommendation: 'needs-rework',
      };
    }

    return agent(
      `You are adversarially verifying work claimed complete for Linear issue ${issue.id}.

Your default posture is SKEPTICAL. The executing agent claims it satisfied every
acceptance criterion. Your job is to find out where that is not true.

# The issue, verbatim

## ${issue.id}: ${issue.title}

${issue.body}

# What the executing agent claims

${JSON.stringify(report, null, 2)}

# How to verify

You are in your OWN private git worktree. Stay in it. Fetch the pushed branch
and check it out DETACHED:

    git fetch origin ${issue.branch}
    git switch --detach FETCH_HEAD

Use \`git switch --detach\`, not \`git checkout\`: this repository's settings deny
the \`git checkout --\` prefix outright, so the checkout form is rejected before
it selects anything, and you would silently verify your worktree's original
revision instead of the branch under test. Detaching also avoids colliding with
the branch attachment another worktree already holds.

Never leave your worktree for the orchestrator's checkout of this repository,
whatever its path. Switching branches there corrupts work in progress, and two
verifiers doing it concurrently would each verify a mixture of two branches.

Then, for EVERY numbered acceptance criterion, establish independently whether
it holds. Re-run the verification commands yourself and record the REAL exit
codes — do not take the report's word for them, and do not grep output to decide
pass or fail.

Two failure classes recur in this project. Check both explicitly:

1. **A test that passes while the fix is absent.** For each new test, revert or
   neutralize the thing it guards and confirm the test actually fails. **Restore
   the worktree after every such mutation, before checking the next criterion** —
   \`git stash\` or \`git restore\` the file — or later commands run against a
   deliberately broken tree and report unrelated false failures.
2. **Configuration added to a schema but never wired into the gate meant to
   enforce it.** If a value was added anywhere, trace it to the code path that
   actually reads and enforces it. An unread field is not a control.

Also check that nothing outside the issue's scope was changed, that no aggregate
script was edited, that no test was skipped, weakened, or given a raised
timeout, and that every citation says what it is claimed to say.

Do NOT fix anything. Report only.

Set \`confirmedMet\` true only if every numbered criterion genuinely holds. Use
\`recommendation\` for your overall verdict: a problem outside the numbered
criteria — an out-of-scope change, a fabricated citation, a weakened test — is
grounds for \`needs-rework\` even when every numbered criterion passes. Put every
such problem in \`problems\`.`,
      {
        label: `verify:${issue.id}`,
        phase: 'Verify',
        model: 'opus',
        effort: 'high',
        isolation: 'worktree',
        schema: VERDICT_SCHEMA,
      },
    );
  },
);

// A falsy result here means the verifier itself died or was skipped. Filtering
// it away would drop the issue from BOTH collections and leave the orchestrator
// with no record that it was ever dispatched, so it becomes an explicit verdict.
const verdicts = results.map((result, index) =>
  result
    ? result
    : {
        issue: issues[index].id,
        criteriaVerified: [],
        confirmedMet: false,
        problems: ['Stage 2 verifier produced no verdict (died, errored, or was skipped). Work is unverified.'],
        recommendation: 'needs-rework',
      },
);

// Readiness honours the verifier's own recommendation, not just confirmedMet.
// A verifier can legitimately confirm every numbered criterion and still return
// needs-rework for a problem outside them; treating confirmedMet alone as ready
// discards that verdict. This has already happened once in practice.
const ready = verdicts.filter((v) => v.confirmedMet && v.recommendation === 'open-pull-request');
const rework = verdicts.filter((v) => !(v.confirmedMet && v.recommendation === 'open-pull-request'));

log(`Verified: ${ready.length} ready for a pull request, ${rework.length} needing attention.`);
for (const verdict of rework) {
  log(`  ${verdict.issue} [${verdict.recommendation}]: ${(verdict.problems || []).join('; ') || 'no detail given'}`);
}
// Problems on an otherwise-ready issue are still worth surfacing rather than dropping.
for (const verdict of ready) {
  if ((verdict.problems || []).length) {
    log(`  ${verdict.issue} [ready, with notes]: ${verdict.problems.join('; ')}`);
  }
}

return { ready, rework, all: verdicts, invalid: [] };
