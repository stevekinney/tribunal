#!/usr/bin/env bun
/**
 * Fails (non-zero exit) if any workflow under `.github/workflows/` violates
 * Tribunal's workflow-security policy: missing a top-level `permissions:`
 * block, a job holding write permissions or secrets on an untrusted-content
 * trigger without a read-only, secret-free authorization gate ahead of it,
 * a `run:` step that interpolates attacker-controlled event text directly
 * as shell syntax, or one of the four root workflow-security commands
 * (including this one) having been silently un-wired from `ci.yml`.
 *
 * Deliberately narrower than a maximal hardening policy: full-commit-SHA
 * action pinning and a mandatory per-job `permissions:` block would each
 * fail against every workflow in this repository today (Tribunal pins most
 * actions to version tags -- `superfly/flyctl-actions/setup-flyctl` is the
 * one exception, already SHA-pinned -- and scopes permissions at the
 * workflow level, not per job). Per-job `timeout-minutes:` and mandatory
 * `concurrency:` are NOT in that position: every real job already declares
 * a `timeout-minutes:` except `ci-status` (a trivial `needs:`-aggregator
 * with no steps worth timing out), and both `ci.yml` and
 * `deploy-production.yml` already carry workflow-level `concurrency:` while
 * both jobs in `neon-pull-request-branches.yml` carry job-level
 * `concurrency:`. Those two are left out of scope for TRI-28 (a repository
 * workflow rewrite, not a policy-module change) rather than because they
 * would currently fail. See the TRI-28 pull request notes for the full
 * list of policy rules considered and deferred.
 */

import {
  auditWorkflows,
  ciWiringViolations,
  findUnsafeExpressionInterpolation,
  formatViolations,
  loadAllWorkflows,
} from './workflow-policy';

const violations = auditWorkflows();
for (const { fileName, workflow } of loadAllWorkflows()) {
  for (const violation of findUnsafeExpressionInterpolation(workflow)) {
    violations.push({ ...violation, fileName: `${fileName} (${violation.fileName})` });
  }
}
violations.push(...ciWiringViolations());

if (violations.length === 0) {
  console.log('audit:workflows: no violations found.');
  process.exit(0);
}

console.error(`audit:workflows: ${violations.length} violation(s) found:\n`);
console.error(formatViolations(violations));
process.exit(1);
