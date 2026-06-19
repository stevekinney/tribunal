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

  const requestedPath = getRequestedPath(policyInput.toolName, policyInput.input);
  if (requestedPath !== null && !isRepositoryRelativePath(requestedPath)) {
    return { permissionDecision: 'deny', reason: 'tool path escapes the repository' };
  }
  const requestedPattern = getRequestedGlobPattern(policyInput.toolName, policyInput.input);
  if (requestedPattern !== null && !isRepositoryRelativePattern(requestedPattern)) {
    return { permissionDecision: 'deny', reason: 'tool path escapes the repository' };
  }
  if (requiresChangedFileScope(policyInput.toolName)) {
    if (requestedPath === null) {
      return { permissionDecision: 'deny', reason: 'read path is required' };
    }
    if (!policyInput.diffContext.changedFiles.some((file) => file.path === requestedPath)) {
      return { permissionDecision: 'deny', reason: 'read path is outside the pull request diff' };
    }
  }

  return { permissionDecision: 'allow' };
}

function requiresChangedFileScope(toolName: string): boolean {
  return toolName === 'Read' || toolName === 'mcp__tribunal__read_base_file';
}

function getRequestedPath(toolName: string, input: Record<string, unknown>): string | null {
  const keys = toolName === 'Grep' ? ['path'] : ['file_path', 'path'];
  for (const key of keys) {
    const value = input[key];
    if (typeof value === 'string') return value;
  }

  return null;
}

function getRequestedGlobPattern(toolName: string, input: Record<string, unknown>): string | null {
  if (toolName !== 'Glob') return null;
  return typeof input.pattern === 'string' ? input.pattern : '';
}

function isRepositoryRelativePattern(pattern: string): boolean {
  if (pattern.length === 0) return false;
  if (pattern.includes('\\')) return false;
  if (/[{}]/u.test(pattern)) return false;
  if (/[!@+*?]\(/u.test(pattern)) return false;
  if (pattern.startsWith('/') || /^[A-Za-z]:/u.test(pattern)) return false;
  return !pattern.split('/').includes('..');
}
