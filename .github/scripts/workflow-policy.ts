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
const UNTRUSTED_EVENTS = new Set([
  'issue_comment',
  'pull_request_review_comment',
  'issues',
  'pull_request_target',
]);

export interface WorkflowStep {
  name?: string;
  uses?: string;
  run?: string;
  with?: Record<string, unknown>;
  env?: Record<string, unknown>;
  if?: string;
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
  steps?: WorkflowStep[];
}

export interface Workflow {
  name?: string;
  on?: unknown;
  permissions?: Record<string, string> | string;
  concurrency?: unknown;
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

/** True if a job declares any permission above `read` (including `write-all`). */
export function jobGrantsWrite(job: WorkflowJob): boolean {
  if (!job.permissions) return false;
  if (typeof job.permissions === 'string') {
    return job.permissions === 'write-all';
  }
  return Object.values(job.permissions).some((level) => level === 'write');
}

/** True if any step in the job references `secrets.` (excluding `secrets: inherit`). */
export function jobUsesSecrets(job: WorkflowJob): boolean {
  if (job.secrets) return true;
  const haystacks: string[] = [];
  if (job.env) haystacks.push(JSON.stringify(job.env));
  for (const step of job.steps ?? []) {
    if (step.with) haystacks.push(JSON.stringify(step.with));
    if (step.env) haystacks.push(JSON.stringify(step.env));
    if (step.run) haystacks.push(step.run);
  }
  return haystacks.some((text) => /\bsecrets\./.test(text));
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
  /^needs\.([A-Za-z0-9_-]+)\.outputs\.[A-Za-z0-9_-]+\s*==\s*['"]true['"]$/;

/**
 * A job is authorization-gated when its `if:` requires equality against a
 * positive (`'true'`) authorization output from a job actually named in its
 * own `needs:`, so it cannot run for an actor the authorization job
 * rejected — and cannot be satisfied by a same-named-but-unrelated output,
 * a negated condition, or a job outside its own `needs:` chain.
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
  if (!needs.includes(referencedJobName)) return false;

  // The upstream job it depends on must itself hold no write permissions
  // and no secrets, or the "gate" grants nothing.
  return needs.every((upstream) => {
    const upstreamJob = workflow.jobs[upstream];
    return (
      upstreamJob !== undefined && !jobGrantsWrite(upstreamJob) && !jobUsesSecrets(upstreamJob)
    );
  });
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

    if (isUntrustedTriggered(workflow)) {
      for (const [jobName, job] of Object.entries(workflow.jobs ?? {})) {
        const privileged = jobGrantsWrite(job) || jobUsesSecrets(job);
        if (privileged && !isAuthorizationGated(workflow, jobName)) {
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
    }
  }

  return violations;
}

export function formatViolations(violations: Violation[]): string {
  return violations.map((v) => `${v.fileName}: [${v.rule}] ${v.message}`).join('\n');
}

// Expression fragments that name attacker-controlled text (an issue title
// or body, a comment body, a review body, or a branch/head ref an attacker
// names). Interpolating any of these directly into a `run:` shell block
// (rather than passing them through `env:` and referencing the environment
// variable) lets the attacker's text execute as shell syntax.
const UNTRUSTED_EXPRESSION_FRAGMENTS = [
  'github.event.issue.title',
  'github.event.issue.body',
  'github.event.comment.body',
  'github.event.review.body',
  'github.event.pull_request.title',
  'github.event.pull_request.body',
  'github.head_ref',
];

interface RunBlock {
  jobName: string;
  stepIndex: number;
  script: string;
}

function collectRunBlocks(workflow: Workflow): RunBlock[] {
  const blocks: RunBlock[] = [];
  for (const [jobName, job] of Object.entries(workflow.jobs ?? {})) {
    (job.steps ?? []).forEach((step, stepIndex) => {
      if (typeof step.run === 'string') {
        blocks.push({ jobName, stepIndex, script: step.run });
      }
    });
  }
  return blocks;
}

/**
 * Finds `run:` steps that interpolate attacker-controlled text directly as
 * shell syntax via `${{ ... }}`, instead of passing it through `env:`.
 */
export function findUnsafeExpressionInterpolation(workflow: Workflow): Violation[] {
  const violations: Violation[] = [];
  for (const block of collectRunBlocks(workflow)) {
    for (const fragment of UNTRUSTED_EXPRESSION_FRAGMENTS) {
      if (block.script.includes(`\${{ ${fragment}`) || block.script.includes(`\${{${fragment}`)) {
        violations.push({
          fileName: `${block.jobName}[${block.stepIndex}]`,
          rule: 'unsafe-run-interpolation',
          message: `run: step interpolates "${fragment}" directly; pass it through env: instead.`,
        });
      }
    }
  }
  return violations;
}
