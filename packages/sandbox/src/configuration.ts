import type { RepoRef } from '@tribunal/review-core/ports';

export type PullRequestSandboxKey = {
  repositoryId: number;
  pullRequestNumber: number;
};

export type SandboxEgressConfiguration = {
  allowInternetAccess: false;
  allowOut: string[];
  secretNames: [];
  env: {
    TRIBUNAL_PROXY_URL: string;
    ANTHROPIC_BASE_URL: string;
  };
};

export type CloneInputValidationResult = { ok: true } | { ok: false; reason: string };
export type SandboxReuseIsolationResult = { ok: true } | { ok: false; reason: string };

export type SandboxReuseIsolationCandidate = {
  allowInternetAccess?: unknown;
  allowOut?: unknown;
  network?: {
    allowInternetAccess?: unknown;
    allowOut?: unknown;
  };
  secretNames?: unknown;
};

/** Builds the stable Tensorlake sandbox name for one open pull request. */
export function makeSandboxName(key: PullRequestSandboxKey): string {
  return `tribunal-pr-${key.repositoryId}-${key.pullRequestNumber}`;
}

/** Builds deterministic metadata for Tribunal-managed sandboxes. */
export function makeSandboxMetadata(key: PullRequestSandboxKey & RepoRef): Record<string, string> {
  return {
    managedBy: 'tribunal',
    owner: key.owner,
    pullRequestNumber: String(key.pullRequestNumber),
    repositoryId: String(key.repositoryId),
    repositoryName: key.name,
  };
}

/** Represents the MVP sandbox egress policy: no internet, proxy CIDR only, no secrets. */
export function buildProxyOnlyEgressConfiguration(input: {
  proxyUrl: string;
  proxyCidr: string;
}): SandboxEgressConfiguration {
  const proxyUrl = input.proxyUrl.replace(/\/+$/u, '');
  return {
    allowInternetAccess: false,
    allowOut: [input.proxyCidr],
    secretNames: [],
    env: {
      TRIBUNAL_PROXY_URL: proxyUrl,
      ANTHROPIC_BASE_URL: `${proxyUrl}/anthropic/api.anthropic.com`,
    },
  };
}

export function verifySandboxReuseIsolation(
  candidate: SandboxReuseIsolationCandidate,
  expected: SandboxEgressConfiguration,
): SandboxReuseIsolationResult {
  const allowInternetAccess =
    candidate.network?.allowInternetAccess ?? candidate.allowInternetAccess;
  const allowOut = candidate.network?.allowOut ?? candidate.allowOut;

  if (allowInternetAccess !== false) {
    return { ok: false, reason: 'allowInternetAccess is not disabled' };
  }

  if (!Array.isArray(allowOut) || !sameStringSet(allowOut, expected.allowOut)) {
    return { ok: false, reason: 'allowOut does not match the proxy-only egress policy' };
  }

  if (!Array.isArray(candidate.secretNames) || candidate.secretNames.length > 0) {
    return {
      ok: false,
      reason: 'sandbox has retained secret names or secretNames is unknown',
    };
  }

  return { ok: true };
}

/** Validates the credential-less GitHub clone URL and exact head SHA used in the sandbox. */
export function validateCloneInput(input: {
  repositoryUrl: string;
  headSha: string;
}): CloneInputValidationResult {
  if (
    !/^https:\/\/github\.com\/[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*(?:\.git)?$/.test(
      input.repositoryUrl,
    )
  ) {
    return { ok: false, reason: 'repository URL must be a GitHub HTTPS clone URL' };
  }

  if (!/^[a-f0-9]{40}$/i.test(input.headSha)) {
    return { ok: false, reason: 'head SHA must be a 40-character hexadecimal commit id' };
  }

  return { ok: true };
}

function sameStringSet(left: readonly unknown[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  return right.every((expectedValue) => left.includes(expectedValue));
}
