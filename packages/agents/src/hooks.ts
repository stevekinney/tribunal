import type { DiffContext } from '@tribunal/review-core/types';
import { ALLOWED_AGENT_TOOLS } from './definitions';
import { isRepositoryRelativePath, validateFinding } from './findings';

const allowedToolNames = new Set<string>(ALLOWED_AGENT_TOOLS);

export type HookPolicyInput = {
  toolName: string;
  input: Record<string, unknown>;
  repositoryRoot: string;
  diffContext: DiffContext;
};

export type HookPolicyDecision =
  | { permissionDecision: 'allow' }
  | { permissionDecision: 'deny'; reason: string };

/** Enforces Tribunal's read-only tool and repository-boundary policy for PreToolUse hooks. */
export function enforceReadOnlyToolUse(policyInput: HookPolicyInput): HookPolicyDecision {
  if (!allowedToolNames.has(policyInput.toolName)) {
    return { permissionDecision: 'deny', reason: 'tool is not in the Tribunal review allowlist' };
  }

  if (policyInput.toolName === 'mcp__tribunal__record_finding') {
    const validation = validateFinding(policyInput.input.finding, policyInput.diffContext);
    return validation.ok
      ? { permissionDecision: 'allow' }
      : { permissionDecision: 'deny', reason: validation.reason };
  }

  const requestedPath = getRequestedPath(policyInput.input);
  if (requestedPath !== null && !isRepositoryRelativePath(requestedPath)) {
    return { permissionDecision: 'deny', reason: 'tool path escapes the repository' };
  }
  if (
    policyInput.toolName === 'Read' &&
    requestedPath !== null &&
    !policyInput.diffContext.changedFiles.some((file) => file.path === requestedPath)
  ) {
    return { permissionDecision: 'deny', reason: 'read path is outside the pull request diff' };
  }

  return { permissionDecision: 'allow' };
}

function getRequestedPath(input: Record<string, unknown>): string | null {
  for (const key of ['file_path', 'path', 'pattern']) {
    const value = input[key];
    if (typeof value === 'string') return value;
  }

  return null;
}
