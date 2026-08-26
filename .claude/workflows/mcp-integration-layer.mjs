export const meta = {
  name: 'mcp-integration-layer',
  description: 'Drive one opened layer of the Tribunal MCP integration graph: implement each issue, adversarially verify it, push a branch',
  whenToUse: 'After a layer of the TRI MCP graph opens. Pass args.issues; the orchestrator drives PR gates and Linear separately.',
  phases: [
    { title: 'Execute', detail: 'one agent per issue: implement or draft the decision, then push a branch' },
    { title: 'Verify', detail: 'adversarial pass: does each acceptance criterion actually hold?' },
  ],
};

const REPO = '/Users/stevekinney/Developer/tribunal';

// Non-negotiables that every agent in this project inherits. These trace to
// two inherited failure classes: a test suite passing while the fix is absent,
// and configuration added to a schema but never wired into its gate.
const HOUSE_RULES = `
## Repository

You are already inside your OWN private git worktree of the Tribunal repository:
a complete checkout, safe to edit. Work there and only there.

Never \`cd\` to ${REPO} itself. That is the orchestrator's live checkout, and
switching branches inside it corrupts work in progress.

## Non-negotiable discipline

- Use \`bun\`, never npm/yarn/pnpm. Run scripts with \`bun run <script>\`.
- Check pass/fail by EXIT CODE, never by grepping output. Tool output carries ANSI
  escapes, so \`grep -c "error TS"\` can report zero against output that plainly
  contains errors. Use \`cmd > /dev/null 2>&1; echo $?\`.
- NEVER use \`--no-verify\`, \`HUSKY=0\`, or \`CI=1\` to get past a hook.
- NEVER raise a timeout, retry count, or resource limit to turn a check green.
- NEVER skip a test, comment out an assertion, or leave a TODO in place of a fix.
  If the issue as scoped cannot be finished, say so in your report instead of
  shipping a partial dressed up as complete.
- Test runner is vitest. No \`bun:test\` may enter this repository.
- Prefer full words in names: \`configuration\` not \`config\`, \`utilities\` not \`utils\`.
- Kebab-case filenames. TypeScript only (\`.ts\`/\`.tsx\`).
- Match existing repository conventions. Inspect neighbouring files before
  inventing a new pattern or directory.
- Markdown: em dashes tight (no spaces), no horizontal rules, no numbered
  headings, no bold inside headings, cap heading depth at three levels.

## Your deliverable

Create your branch from \`main\` and work only there:

    git fetch origin main
    git switch -c BRANCH_NAME origin/main

Commit your work and push it with \`git push -u origin BRANCH_NAME\`.

Do NOT open a pull request — the orchestrator does that. Do NOT touch Linear:
you have no Linear write access and moving a ticket is the orchestrator's job,
per \`.claude/skills/execute-plan/SKILL.md\` and the orchestration document.
Never commit directly to \`main\`.

Return a report: what you changed, the exact verification commands you ran with
their exit codes, and any acceptance criterion you could NOT satisfy (with why).
`;

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
          evidence: { type: 'string', description: 'The command run and its exit code, or the file/line inspected' },
        },
      },
    },
    confirmedMet: { type: 'boolean', description: 'true only if EVERY criterion is met' },
    problems: { type: 'array', items: { type: 'string' } },
    recommendation: { type: 'string', enum: ['open-pull-request', 'needs-rework', 'hand-back-to-human'] },
  },
};

const issues = (args && args.issues) || [];
if (!issues.length) {
  log('No issues passed in args.issues — nothing to do.');
  return { results: [] };
}

log(`Layer opened with ${issues.length} issue(s): ${issues.map((i) => i.id).join(', ')}`);

const results = await pipeline(
  issues,

  // Stage 1 — implement, or draft the decision. One agent per issue, isolated.
  (issue) => {
    const houseRules = HOUSE_RULES.split('BRANCH_NAME').join(issue.branch);

    const decisionFraming = `
## This is a DECISION issue — draft, do not self-approve

Your job is to produce a decision document that a human approves. That means:

- Lay out the genuine options with their trade-offs.
- Make a clear recommendation and say why.
- Mark anything you could not resolve from the codebase as an OPEN QUESTION
  rather than quietly picking an answer.
- Do NOT write it as though the decision is already settled and do NOT claim
  approval. The human checkpoint is the point of this issue.

Ground every claim in the actual codebase. Read the real capability surface
before naming scopes or bindings — do not carry Protokit's template demo
content across.`;

    const implementationFraming = `
## This is an IMPLEMENTATION issue

For every acceptance criterion, prove it holds by running something that exits
non-zero when it does not. If a criterion asks you to demonstrate a guard fails
when removed, actually remove it, capture the failing run, restore it, and
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

${houseRules}

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
      return { issue: issue.id, criteriaVerified: [], confirmedMet: false, problems: ['Stage 1 agent produced no report (died or was skipped).'], recommendation: 'needs-rework' };
    }
    if (!report.pushed) {
      return { issue: issue.id, criteriaVerified: [], confirmedMet: false, problems: [`Branch ${issue.branch} was not pushed. Notes: ${report.notes}`], recommendation: 'needs-rework' };
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
    git checkout --detach FETCH_HEAD

Detached is required, not stylistic: the branch is already attached to another
worktree, so \`git checkout ${issue.branch}\` fails outright.

Never \`cd\` to ${REPO}. That is the orchestrator's live checkout. Switching
branches there corrupts work in progress, and two verifiers doing it
concurrently would each silently verify a mixture of two branches.

Then, for EVERY numbered acceptance criterion, establish independently whether
it holds. Re-run the verification commands yourself and record the REAL exit
codes — do not take the report's word for them, and do not grep output to decide
pass/fail.

Two failure classes are known to recur in this project. Check both explicitly:

1. **A test that passes while the fix is absent.** For each new test, revert or
   neutralize the thing it supposedly guards and confirm the test actually
   fails. A test that still passes with the guard removed proves nothing.
2. **Configuration added to a schema but never wired into the gate meant to
   enforce it.** If a value was added anywhere, trace it to the code path that
   actually reads and enforces it. An unread field is not a control.

Also check that nothing outside the issue's scope was changed, that no aggregate
script was edited, and that no test was skipped, weakened, or given a raised
timeout to make it pass.

Do NOT fix anything. Report only. Set confirmedMet true only if every single
criterion genuinely holds.`,
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

const clean = results.filter(Boolean);
const ready = clean.filter((r) => r.confirmedMet);
const rework = clean.filter((r) => !r.confirmedMet);

log(`Verified: ${ready.length} ready for a pull request, ${rework.length} needing rework.`);
for (const r of rework) log(`  ${r.issue}: ${(r.problems || []).join('; ') || 'no detail'}`);

return { ready, rework, all: clean };
