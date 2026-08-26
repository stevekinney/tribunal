/**
 * Shared parsing and policy checks for GitHub Actions workflow files.
 *
 * Used by `bun run audit:workflows` (the CI-facing audit script) and by the
 * `test:workflow-authorization` and `test:workflow-prompt-injection` suites,
 * so the audit and the tests can never silently drift apart.
 *
 * Parses with the `yaml` package rather than `Bun.YAML` so this module loads
 * identically under `bun run` (the audit script) and under Vitest, whose
 * worker processes run on Node.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';

const WORKFLOWS_DIRECTORY = join(import.meta.dirname, '..', 'workflows');

// Events whose payload text is authored by, or whose base-repo execution
// context is reachable by, an untrusted party (any GitHub user, not just
// repository collaborators). Bare `pull_request` is deliberately excluded:
// GitHub itself withholds repository secrets and grants only a read-only
// `GITHUB_TOKEN` to `pull_request` runs triggered from a fork, so a job on
// that trigger cannot leak a secret it was never handed. `pull_request_target`
// has no such protection (it runs with base-repo secrets even for fork
// PRs), so it stays untrusted.
//
// `workflow_run` is untrusted for the same reason as `pull_request_target`:
// it always executes in base-repo context with full secrets, regardless of
// whether the workflow run it completed came from a fork PR. It is the
// only untrusted trigger actually used in this repository today --
// `deploy-production.yml` triggers on it (TRI-28 B1).
//
// `discussion`, `discussion_comment`, and `pull_request_review` join the
// set on the same reasoning as `issue_comment`/`issues`/
// `pull_request_review_comment`: their payload text (a discussion title or
// body, a review body) is authored by any GitHub user. No current workflow
// triggers on any of the three, so adding them is a zero-false-positive
// change that closes the gap with the untrusted-fragment list below, which
// already treats `github.event.review.body` as attacker text.
const UNTRUSTED_EVENTS = new Set([
  'issue_comment',
  'pull_request_review_comment',
  'issues',
  'pull_request_target',
  'workflow_run',
  'discussion',
  'discussion_comment',
  'pull_request_review',
]);

export interface WorkflowStep {
  name?: string;
  uses?: string;
  run?: string;
  shell?: string;
  with?: Record<string, unknown>;
  env?: Record<string, unknown>;
  if?: string;
  'continue-on-error'?: boolean | string;
}

export interface WorkflowJob {
  name?: string;
  if?: string;
  needs?: string | string[];
  permissions?: Record<string, string> | string;
  environment?: string | { name: string };
  'timeout-minutes'?: number;
  concurrency?: unknown;
  secrets?: unknown;
  env?: Record<string, unknown>;
  uses?: string;
  steps?: WorkflowStep[];
  // Left loose (rather than a fully-typed `container.env`/`container.credentials`
  // shape) so `jobUsesSecrets` below can stringify whatever expression-bearing
  // fields either object actually carries in a real workflow (TRI-28 C3).
  container?: Record<string, unknown>;
  services?: Record<string, unknown>;
}

export interface Workflow {
  name?: string;
  on?: unknown;
  permissions?: Record<string, string> | string;
  concurrency?: unknown;
  env?: Record<string, unknown>;
  jobs: Record<string, WorkflowJob>;
}

export interface WorkflowFile {
  fileName: string;
  path: string;
  raw: string;
  workflow: Workflow;
}

export interface Violation {
  fileName: string;
  rule: string;
  message: string;
}

export function listWorkflowFiles(): string[] {
  return readdirSync(WORKFLOWS_DIRECTORY)
    .filter((entry) => entry.endsWith('.yml') || entry.endsWith('.yaml'))
    .sort();
}

export function loadWorkflow(fileName: string): WorkflowFile {
  const path = join(WORKFLOWS_DIRECTORY, fileName);
  const raw = readFileSync(path, 'utf8');
  const workflow = parse(raw) as Workflow;
  return { fileName, path, raw, workflow };
}

export function loadAllWorkflows(): WorkflowFile[] {
  return listWorkflowFiles().map(loadWorkflow);
}

/** Every event name this workflow's `on:` trigger listens for. */
export function triggerEvents(workflow: Workflow): string[] {
  const on = workflow.on;
  if (typeof on === 'string') return [on];
  if (Array.isArray(on)) return on.map(String);
  if (on && typeof on === 'object') return Object.keys(on as Record<string, unknown>);
  return [];
}

export function isUntrustedTriggered(workflow: Workflow): boolean {
  return triggerEvents(workflow).some((event) => UNTRUSTED_EVENTS.has(event));
}

/**
 * True if a job declares any permission above `read` (including
 * `write-all`). A job with no job-level `permissions:` block inherits the
 * workflow-level one -- it does NOT default to read-only -- so the
 * effective grant is `job.permissions ?? workflow.permissions` (TRI-28 B2).
 * A job-level block, when present, replaces the workflow-level one; it
 * does not merge with it.
 */
export function jobGrantsWrite(job: WorkflowJob, workflow: Workflow): boolean {
  const effective = job.permissions ?? workflow.permissions;
  if (!effective) return false;
  if (typeof effective === 'string') {
    return effective === 'write-all';
  }
  return Object.values(effective).some((level) => level === 'write');
}

// Matches `secrets.NAME` (property access), `secrets['NAME']`/`secrets["NAME"]`
// (bracket access), and the ambient `github.token` -- a repository-scoped
// token GitHub injects for every run, functionally a secret even though it
// is never named `secrets.*` (TRI-28 B3).
const SECRET_REFERENCE_PATTERN = /\bsecrets(?:\.\w+|\[)|\bgithub\.token\b/;

/**
 * True if the job references a secret: via `secrets.NAME`, bracket-form
 * `secrets['NAME']`, or `github.token`, in any step's `run:`/`with:`/`env:`,
 * in the job's own `env:`, in the workflow-level `env:` (a secret assigned
 * there, e.g. `ci.yml`'s top-level `TURBO_TOKEN`, is otherwise invisible to
 * a check that only ever receives the job), or via a truthy `job.secrets`
 * (including the literal `secrets: inherit` used on a reusable-workflow
 * call). `secrets: inherit` counts as "uses secrets": it hands the invoked
 * reusable workflow every repository secret, which is a strictly BROADER
 * exposure than naming one explicitly, so excluding it would under-count
 * privilege rather than correctly narrow it (TRI-28 B4). Also scans the
 * job's `container:` (its `env:` and `credentials:`) and every entry under
 * `services:` -- a secret handed to a job's container or a service
 * container is available inside the job's run environment exactly like a
 * step-level secret, and was previously invisible to this check entirely
 * (TRI-28 C3).
 */
export function jobUsesSecrets(job: WorkflowJob, workflow?: Workflow): boolean {
  if (job.secrets) return true;
  const haystacks: string[] = [];
  if (workflow?.env) haystacks.push(JSON.stringify(workflow.env));
  if (job.env) haystacks.push(JSON.stringify(job.env));
  if (job.container) haystacks.push(JSON.stringify(job.container));
  if (job.services) haystacks.push(JSON.stringify(job.services));
  for (const step of job.steps ?? []) {
    if (step.with) haystacks.push(JSON.stringify(step.with));
    if (step.env) haystacks.push(JSON.stringify(step.env));
    if (step.run) haystacks.push(step.run);
  }
  return haystacks.some((text) => SECRET_REFERENCE_PATTERN.test(text));
}

/** The `needs:` job names for a job, normalized to an array. */
export function jobNeeds(job: WorkflowJob): string[] {
  if (!job.needs) return [];
  return Array.isArray(job.needs) ? job.needs : [job.needs];
}

/**
 * `job.if` must equal (never merely reference) a positive authorization
 * output — `needs.<upstreamJobName>.outputs.<outputName> == '<approvedValue>'`
 * — where `<upstreamJobName>` is one of the job's own `needs:` entries.
 *
 * A regex that only checks whether the accepted fragment appears somewhere
 * inside `job.if` is defeated by wrapping it in a larger expression with an
 * alternate truth path (`... == 'true' || always()`), or by a negation
 * (`... != 'true'`), or by a same-named-but-unrelated job outside this job's
 * own `needs:` chain. This is fixed by requiring the *entire* (trimmed)
 * `if:` string to be nothing but the single positive comparison — fully
 * anchored with `^`/`$`, no other characters, operators, or function calls
 * permitted before or after it.
 */
const POSITIVE_AUTHORIZATION_CONDITION =
  /^needs\.([A-Za-z0-9_-]+)\.outputs\.([A-Za-z0-9_-]+)\s*==\s*['"]true['"]$/;

/**
 * Finds every `run:` line, across every step in the job, that assigns
 * `outputName` via the `echo "<outputName>=<value>" >> "$GITHUB_OUTPUT"`
 * idiom (unquoted or single/double-quoted around the name), and returns
 * ONLY the assigned value -- the text between the `<outputName>=` and the
 * redirect into `$GITHUB_OUTPUT` -- never the whole line. Bounding the
 * extraction there matters: `$GITHUB_OUTPUT` is a plain `name=value` file,
 * so anything a shell comment or chained command appends AFTER the
 * redirect is never actually part of the written value and must not count
 * toward "the assigned value" for predicate matching (TRI-28 C1).
 *
 * Deliberately does NOT recognize the heredoc multi-line `$GITHUB_OUTPUT`
 * form, or an assignment via a job-level `outputs:` mapping pointing at a
 * step id. An authorization signal expressed either of those ways is
 * unusual enough that requiring this simpler, single-line shape is the
 * standardized shape this check enforces, rather than attempting to
 * generically evaluate every way GitHub Actions can produce a job output.
 */
function findOutputAssignmentValues(job: WorkflowJob, outputName: string): string[] {
  const escapedName = escapeRegExp(outputName);
  const assignmentStart = new RegExp(`^\\s*echo\\s+["']?${escapedName}=`);
  const values: string[] = [];
  for (const step of job.steps ?? []) {
    if (typeof step.run !== 'string') continue;
    for (const line of step.run.split('\n')) {
      if (!assignmentStart.test(line) || !/\$GITHUB_OUTPUT/.test(line)) continue;
      const afterName = line.slice(line.indexOf(`${outputName}=`) + outputName.length + 1);
      const redirectMatch = />>\s*["']?\$GITHUB_OUTPUT/.exec(afterName);
      const value = redirectMatch ? afterName.slice(0, redirectMatch.index) : afterName;
      values.push(value.trim());
    }
  }
  return values;
}

/**
 * True when `value` is EXACTLY one `${{ ... }}` GitHub Actions expression
 * (a trailing stray quote character from the enclosing `echo "..."` is
 * tolerated) -- and nothing else: no literal text before or after it, and
 * no second `${{` anywhere in the value. Requiring the whole assigned
 * value to be a single, unadorned expression is what makes the predicate
 * check below meaningful: without it, an attacker could glue arbitrary
 * extra text (including a fake mention of a trust signal) onto a
 * hardcoded value, or concatenate a second, unrelated expression, and have
 * it read as "derived from a check" when it is not.
 */
function asSingleTemplateExpression(value: string): string | undefined {
  if ((value.match(/\$\{\{/g)?.length ?? 0) !== 1) return undefined;
  const match = /^\$\{\{([\s\S]*)\}\}["']?$/.exec(value);
  return match?.[1];
}

/**
 * A recognizable authorization predicate: a check against
 * `author_association`, or an actor allowlist comparison (`contains(...)`
 * involving `github.actor` or a `.user.login` field).
 *
 * TRI-28 B7: `isAuthorizationGated` previously accepted ANY upstream job
 * whose output the privileged job compared to `'true'`, including one that
 * writes a hardcoded `authorized=true` with no check at all, or derives its
 * output from attacker-controlled event text (an issue/comment/PR title or
 * body). Both would satisfy every structural check above while authorizing
 * everybody or nobody. Requiring one of these concrete trust signals closes
 * that gap without requiring a full evaluator for arbitrary step logic.
 */
function isAuthorizationPredicate(expression: string): boolean {
  const normalized = expression.replace(/\s+/g, '');
  return (
    /author_association/.test(normalized) ||
    (/contains\(/.test(normalized) && /(github\.actor\b|\.user\.login\b)/.test(normalized))
  );
}

/**
 * TRI-28 C1: the previous version of this check searched ALL of the
 * upstream job's step text for a recognizable authorization predicate --
 * `author_association`, or a `contains()` actor-allowlist check -- with no
 * requirement that the predicate have anything to do with the SPECIFIC
 * output the privileged job's `if:` actually compares. A job that mentions
 * `author_association` in a harmless log line, while separately emitting a
 * hardcoded `authorized=true` with no check at all, satisfied every
 * structural test while authorizing every commenter unconditionally. This
 * instead locates the line that actually assigns `outputName` to
 * `$GITHUB_OUTPUT`, requires there be EXACTLY ONE such assignment across
 * the whole job ($GITHUB_OUTPUT is last-write-wins at runtime, so two
 * assignments -- one predicate-derived, one hardcoded -- would let the
 * hardcoded one silently win while this check inspected the other),
 * requires that single assigned value to be nothing but one unadorned
 * `${{ ... }}` expression, and only then checks THAT expression for a
 * recognizable predicate.
 */
function upstreamJobHasRecognizableAuthorizationCheck(
  job: WorkflowJob,
  outputName: string,
): boolean {
  if (typeof job.uses === 'string' && /authoriz/i.test(job.uses)) return true;

  const assignedValues = findOutputAssignmentValues(job, outputName);
  if (assignedValues.length !== 1) return false;

  const expression = asSingleTemplateExpression(assignedValues[0]);
  if (expression === undefined) return false;

  return isAuthorizationPredicate(expression);
}

/**
 * A job is authorization-gated when its `if:` requires equality against a
 * positive (`'true'`) authorization output from a job actually named in its
 * own `needs:` — so it cannot run for an actor the authorization job
 * rejected, cannot be satisfied by a same-named-but-unrelated output, a
 * negated condition, or a job outside its own `needs:` chain — every job in
 * that `needs:` chain holds no write permissions and no secrets of its own,
 * and the specific job the condition reads its output from implements a
 * recognizable authorization predicate (TRI-28 B7) rather than a cosmetic
 * one.
 */
export function isAuthorizationGated(workflow: Workflow, jobName: string): boolean {
  const job = workflow.jobs[jobName];
  if (!job) return false;

  const needs = jobNeeds(job);
  if (needs.length === 0) return false;

  const match = POSITIVE_AUTHORIZATION_CONDITION.exec((job.if ?? '').trim());
  if (!match) return false;

  // The job the condition actually reads from must be one this job
  // genuinely `needs:` — a positive condition referencing some other,
  // unrelated job's output would not actually gate this job's execution
  // on anything this job depends on.
  const referencedJobName = match[1];
  const authorizationOutputName = match[2];
  if (!needs.includes(referencedJobName)) return false;

  // Every job this job `needs:` must itself be safe to depend on: no write
  // permissions, no secrets. A privileged, secret-bearing dependency
  // elsewhere in the `needs:` chain would make the "gate" meaningless even
  // if it isn't the specific job whose output is compared.
  const allNeedsAreSafeToDependOn = needs.every((upstream) => {
    const upstreamJob = workflow.jobs[upstream];
    return (
      upstreamJob !== undefined &&
      !jobGrantsWrite(upstreamJob, workflow) &&
      !jobUsesSecrets(upstreamJob, workflow)
    );
  });
  if (!allNeedsAreSafeToDependOn) return false;

  // The job the condition actually authorizes against must implement a
  // recognizable authorization predicate that DERIVES the specific output
  // this condition compares -- not merely produce SOME output the
  // privileged job happens to compare against `'true'` while a recognizable
  // predicate appears elsewhere in the job (TRI-28 C1).
  const referencedJob = workflow.jobs[referencedJobName];
  return (
    referencedJob !== undefined &&
    upstreamJobHasRecognizableAuthorizationCheck(referencedJob, authorizationOutputName)
  );
}

/**
 * A narrow, closed set of (fileName, jobName) exemptions from the
 * untrusted-privileged-job check, for jobs that are provably safe on an
 * untrusted trigger through an authorization SHAPE this module does not
 * (and should not try to) generically recognize, together with the OTHER
 * test suite that structurally enforces that shape stays intact.
 *
 * `deploy-production.yml`'s `deploy` job triggers on `workflow_run` (an
 * untrusted event as of TRI-28 B1) and references secrets directly in
 * `env:`, so it is privileged on an untrusted trigger. It is not gated by
 * the `needs.<job>.outputs.<x> == 'true'` pattern `isAuthorizationGated`
 * recognizes -- it has no `needs:` at all. Instead its `if:` inline-pins
 * execution with `github.event.workflow_run.event == 'push' &&
 * github.event.workflow_run.head_branch == 'main'` (alongside a
 * `workflow_dispatch` branch, which by construction requires write access
 * to trigger manually): a fork-originated CI run always reports
 * `github.event.workflow_run.event == 'pull_request'`, so a fork
 * contributor cannot forge the `push`-on-`main` condition without write
 * access to `main` in the first place.
 *
 * A literal, fully-anchored regex for that exact `if:` string (the
 * approach `POSITIVE_AUTHORIZATION_CONDITION` uses) was considered and
 * rejected: the real condition ANDs in `github.event.workflow_run.
 * conclusion == 'success'` and ORs in the `workflow_dispatch` branch, so
 * matching it exactly would be brittle to reformatting, and matching it
 * loosely would reopen the disjunctive-escape-hatch hole B1 exists to
 * close. A narrow, named exemption is more honest about what is actually
 * being trusted, and — critically — is not a silent trust: this three-link
 * chain is what makes it a control rather than a blind spot.
 *
 *   1. This exemption skips the audit's own untrusted-privileged-job check
 *      for exactly `(deploy-production.yml, deploy)`.
 *   2. `production-migration-gate.test.ts` structurally validates that this
 *      exact job's `if:` shape holds (TRI-28 B8 hardens this from five
 *      independent substring checks to full boolean-structure validation).
 *   3. `ciWiringViolations` (below), which runs inside `audit:workflows`
 *      itself, asserts `test:production-migration-gate` stays wired into
 *      `ci.yml` — so removing THAT suite, not just this exemption, still
 *      fails CI.
 *
 * If this shape is ever generalized (a second workflow needs the same
 * pattern), prefer building a real structural recognizer over widening this
 * list ad hoc.
 */
const UNTRUSTED_TRIGGER_EXEMPTIONS: ReadonlyArray<{ fileName: string; jobName: string }> = [
  { fileName: 'deploy-production.yml', jobName: 'deploy' },
];

function isExemptFromUntrustedTriggerCheck(fileName: string, jobName: string): boolean {
  return UNTRUSTED_TRIGGER_EXEMPTIONS.some(
    (exemption) => exemption.fileName === fileName && exemption.jobName === jobName,
  );
}

/**
 * The job names in this workflow that are privileged (write permissions or
 * secrets) on an untrusted-content trigger without a recognized
 * authorization gate and without a narrow, documented exemption. Exported
 * so `audit:workflows` and `test:workflow-authorization` share one
 * computation and can never silently drift apart.
 */
export function untrustedPrivilegedUngatedJobs(fileName: string, workflow: Workflow): string[] {
  if (!isUntrustedTriggered(workflow)) return [];
  return Object.entries(workflow.jobs ?? {})
    .filter(([jobName, job]) => {
      const privileged = jobGrantsWrite(job, workflow) || jobUsesSecrets(job, workflow);
      return (
        privileged &&
        !isAuthorizationGated(workflow, jobName) &&
        !isExemptFromUntrustedTriggerCheck(fileName, jobName)
      );
    })
    .map(([jobName]) => jobName);
}

export function auditWorkflows(): Violation[] {
  const violations: Violation[] = [];

  for (const { fileName, workflow } of loadAllWorkflows()) {
    if (workflow.permissions === undefined) {
      violations.push({
        fileName,
        rule: 'top-level-permissions',
        message:
          'Workflow has no top-level `permissions:` block. Add an explicit (possibly empty) grant.',
      });
    }

    for (const jobName of untrustedPrivilegedUngatedJobs(fileName, workflow)) {
      violations.push({
        fileName,
        rule: 'untrusted-privileged-job',
        message: `Job "${jobName}" holds write permissions or secrets on an untrusted-content trigger (${triggerEvents(
          workflow,
        )
          .filter((event) => UNTRUSTED_EVENTS.has(event))
          .join(
            ', ',
          )}) without a secret-free, read-only authorization gate in its \`needs:\` chain.`,
      });
    }
  }

  return violations;
}

// The four root workflow-security commands. Wired into ci.yml's
// `lint-format` job (see `ciWiringViolations` below).
const REQUIRED_CI_SECURITY_COMMANDS = [
  'bun run audit:workflows',
  'bun run test:workflow-authorization',
  'bun run test:workflow-prompt-injection',
  'bun run test:production-migration-gate',
];

/**
 * TRI-28 B11: this invariant ("every root workflow-security command stays
 * wired into ci.yml") used to live INSIDE `test:workflow-authorization`
 * itself. That is self-defeating: if `test:workflow-authorization`'s own
 * step is removed from `ci.yml`, that suite simply stops running, and the
 * assertion that would have caught its own removal never executes.
 *
 * Living here instead, inside `audit:workflows` (a genuinely separate
 * command, part of the exemption chain documented on
 * `UNTRUSTED_TRIGGER_EXEMPTIONS` above), means removing ANY ONE of the four
 * security gates from `ci.yml` — including `audit:workflows`' own line, or
 * `test:workflow-authorization`'s — still fails CI, because at least one of
 * the other three gates remains wired in and independently checks that all
 * four are present.
 */
export function ciWiringViolations(): Violation[] {
  const { workflow } = loadWorkflow('ci.yml');
  const job = workflow.jobs['lint-format'];
  if (!job) {
    return [
      {
        fileName: 'ci.yml',
        rule: 'ci-wiring',
        message:
          'ci.yml has no lint-format job; the root workflow-security gates cannot be verified as wired in.',
      },
    ];
  }
  const runCommands = (job.steps ?? []).map((step) => step.run ?? '').join('\n');
  return REQUIRED_CI_SECURITY_COMMANDS.filter((command) => !runCommands.includes(command)).map(
    (command) => ({
      fileName: 'ci.yml',
      rule: 'ci-wiring',
      message: `"${command}" is missing from ci.yml's lint-format job; a root workflow-security gate has been silently un-wired.`,
    }),
  );
}

export function formatViolations(violations: Violation[]): string {
  return violations.map((v) => `${v.fileName}: [${v.rule}] ${v.message}`).join('\n');
}

// Expression fragments that name attacker-controlled text (an issue title
// or body, a comment body, a review body, a discussion title or body, a
// branch/head ref an attacker names, or -- for workflow_run workflows --
// the triggering commit message, the classic pwn-request-via-commit-message
// vector). Interpolating any of these directly into a `run:` shell block
// (rather than passing them through `env:` and referencing the environment
// variable) lets the attacker's text execute as shell syntax.
//
// `github.event.pull_request.head.ref` is listed separately from
// `github.head_ref`: they are distinct expression strings that resolve to
// the same attacker-controlled value (the head branch name), and either
// spelling is equally exploitable.
//
// `github.event.workflow_run.head_branch` (TRI-28 C4) is the same
// attacker-controlled-branch-name class as `head_ref`/`head.ref` above, but
// for the `workflow_run` trigger specifically: a fork contributor names
// their own branch (Git permits shell metacharacters in branch names), and
// `workflow_run` is an untrusted trigger (see `UNTRUSTED_EVENTS`), so a
// privileged `workflow_run` workflow interpolating this directly into
// `run:` is directly exploitable the same way.
const UNTRUSTED_EXPRESSION_FRAGMENTS = [
  'github.event.issue.title',
  'github.event.issue.body',
  'github.event.comment.body',
  'github.event.review.body',
  'github.event.pull_request.title',
  'github.event.pull_request.body',
  'github.event.pull_request.head.ref',
  'github.head_ref',
  'github.event.discussion.title',
  'github.event.discussion.body',
  'github.event.workflow_run.head_commit.message',
  'github.event.workflow_run.head_branch',
];

interface RunBlock {
  jobName: string;
  stepIndex: number;
  // TRI-28 C5: a step's custom `shell:` field is scanned for the same
  // untrusted-interpolation violation as its `run:` script. A commenter who
  // controls `shell: ${{ github.event.comment.body }}` supplies the command
  // interpreter the step's otherwise-harmless `run:` script executes under
  // -- moving attacker input from `run:` to the interpreter selection must
  // not bypass this audit.
  field: 'run' | 'shell';
  script: string;
}

function collectRunBlocks(workflow: Workflow): RunBlock[] {
  const blocks: RunBlock[] = [];
  for (const [jobName, job] of Object.entries(workflow.jobs ?? {})) {
    (job.steps ?? []).forEach((step, stepIndex) => {
      if (typeof step.run === 'string') {
        blocks.push({ jobName, stepIndex, field: 'run', script: step.run });
      }
      if (typeof step.shell === 'string') {
        blocks.push({ jobName, stepIndex, field: 'shell', script: step.shell });
      }
    });
  }
  return blocks;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const EXPRESSION_BLOCK_PATTERN = /\$\{\{([\s\S]*?)\}\}/g;

// Matches GitHub Actions bracket-form property access -- `['name']` or
// `["name"]` -- immediately following an identifier chain, so it can be
// rewritten to the equivalent dot form before fragment matching.
const BRACKET_PROPERTY_ACCESS_PATTERN = /\[['"]([A-Za-z0-9_]+)['"]\]/g;

/**
 * Finds `run:` steps that interpolate attacker-controlled text directly as
 * shell syntax via `${{ ... }}`, instead of passing it through `env:`.
 *
 * TRI-28 B5: the previous implementation only matched the two-character
 * span `${{ fragment` (one leading space) or `${{fragment` (no space), so
 * two spaces, a tab, a newline, or ANY wrapping function call (`format(...)`,
 * `toJson(...)`) — all of which GitHub evaluates identically — bypassed it.
 * This instead extracts the full contents of every `${{ ... }}` expression
 * in the script, strips ALL internal whitespace (GitHub's expression syntax
 * permits arbitrary whitespace between tokens, including around and inside
 * function calls), and searches the ENTIRE normalized expression for each
 * untrusted fragment — so the fragment can appear anywhere in the
 * expression, not only as its literal prefix. A trailing `(?!\w)` boundary
 * keeps a fragment from matching as a prefix of a longer, unrelated
 * identifier (e.g. a hypothetical `github.event.issue.title_hash`).
 *
 * TRI-28 C2: GitHub Actions expression syntax evaluates
 * `github.event['issue']['title']` identically to
 * `github.event.issue.title`, but whitespace normalization alone leaves the
 * brackets intact, so no dot-form fragment in `UNTRUSTED_EXPRESSION_FRAGMENTS`
 * ever matched it. Every `['name']`/`["name"]` index is rewritten to `.name`
 * BEFORE fragment matching -- after whitespace stripping, so a form like
 * `github.event[ 'issue' ]` canonicalizes too -- which also canonicalizes a
 * mixed form like `github.event['issue'].title`.
 *
 * TRI-28 C5: also scans a step's custom `shell:` field, not only its
 * `run:` script. `collectRunBlocks` previously read only `step.run`, so
 * `shell: ${{ github.event.comment.body }}` -- letting a commenter supply
 * the command interpreter itself, which executes before the otherwise-safe
 * `run:` script even runs -- was invisible to this audit entirely.
 */
export function findUnsafeExpressionInterpolation(workflow: Workflow): Violation[] {
  const violations: Violation[] = [];
  for (const block of collectRunBlocks(workflow)) {
    const expressions = [...block.script.matchAll(EXPRESSION_BLOCK_PATTERN)].map(
      (match) => match[1],
    );
    for (const expression of expressions) {
      const normalized = expression
        .replace(/\s+/g, '')
        .replace(BRACKET_PROPERTY_ACCESS_PATTERN, '.$1');
      for (const fragment of UNTRUSTED_EXPRESSION_FRAGMENTS) {
        const boundaryPattern = new RegExp(`${escapeRegExp(fragment)}(?!\\w)`);
        if (boundaryPattern.test(normalized)) {
          violations.push({
            fileName: `${block.jobName}[${block.stepIndex}].${block.field}`,
            rule: 'unsafe-run-interpolation',
            message:
              block.field === 'run'
                ? `run: step interpolates "${fragment}" directly; pass it through env: instead.`
                : `shell: field interpolates "${fragment}" directly; the shell interpreter must be a fixed string, never attacker-controlled text.`,
          });
        }
      }
    }
  }
  return violations;
}

/**
 * Splits a GitHub Actions `if:` boolean expression into its top-level
 * `||`-joined branches, each represented as the SET of its `&&`-joined
 * comparisons (whitespace-normalized and trimmed, with at most one layer of
 * enclosing parens stripped per branch).
 *
 * This is a narrow splitter for the specific flat `(A && B) || (C && D)`
 * shape this repository's conditions actually use, NOT a general boolean
 * expression parser — it does not unwrap nested parens, `!`, or function
 * calls other than a plain `x == 'y'` comparison inside a branch.
 *
 * TRI-28 B8: used to validate `deploy-production.yml`'s production
 * migration gate condition structurally instead of with independent
 * substring checks, which a prepended disjunct like `github.actor ==
 * 'someone' ||` could survive (all five original substring checks still
 * match; the resulting condition is not structurally what the test
 * intends).
 */
export function splitConditionIntoOrBranches(condition: string): Set<string>[] {
  return condition
    .split('||')
    .map((branch) => branch.trim())
    .map((branch) =>
      branch.startsWith('(') && branch.endsWith(')') ? branch.slice(1, -1).trim() : branch,
    )
    .map(
      (branch) => new Set(branch.split('&&').map((clause) => clause.trim().replace(/\s+/g, ' '))),
    );
}
