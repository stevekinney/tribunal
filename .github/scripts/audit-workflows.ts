#!/usr/bin/env bun
/**
 * Fails (non-zero exit) if any workflow under `.github/workflows/` violates
 * Tribunal's workflow-security policy: missing a top-level `permissions:`
 * block, a job holding write permissions or secrets on an untrusted-content
 * trigger without a read-only, secret-free authorization gate ahead of it,
 * or a `run:` step that interpolates attacker-controlled event text
 * directly as shell syntax.
 *
 * Deliberately narrower than a maximal hardening policy (no full-commit-SHA
 * pinning, no per-job permissions/timeout requirement, no mandatory
 * concurrency group): those would fail against every workflow in this
 * repository today, since Tribunal pins actions to version tags and scopes
 * permissions at the workflow level. Introducing those checks is a separate,
 * larger change that rewrites `.github/workflows/**`; see the TRI-28 pull
 * request notes for the full list of policy rules considered and deferred.
 */

import {
  auditWorkflows,
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

if (violations.length === 0) {
  console.log('audit:workflows: no violations found.');
  process.exit(0);
}

console.error(`audit:workflows: ${violations.length} violation(s) found:\n`);
console.error(formatViolations(violations));
process.exit(1);
