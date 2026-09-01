export type ReviewerWorkspaceParity = {
  missing: string[];
  stale: string[];
};

export type ReviewerWorkspaceParityResult = ReviewerWorkspaceParity & {
  exitCode: 0 | 1;
  diagnostics: string[];
};

function copiedWorkspaceManifests(dockerfile: string): string[] {
  return [...dockerfile.matchAll(/^\s*COPY\s+(?:\.\/)?([^\s]+)\/package\.json\s+/gm)]
    .map((match) => match[1])
    .sort();
}

/** Compares root-declared workspaces with manifest copies in the reviewer build context. */
export function compareReviewerWorkspaceManifests(
  workspaces: readonly string[],
  dockerfile: string,
): ReviewerWorkspaceParity {
  const declared = new Set(workspaces);
  const copied = new Set(copiedWorkspaceManifests(dockerfile));
  return {
    missing: [...declared].filter((workspace) => !copied.has(workspace)).sort(),
    stale: [...copied].filter((workspace) => !declared.has(workspace)).sort(),
  };
}

export function reviewerWorkspaceParityResult(
  workspaces: readonly string[],
  dockerfile: string,
): ReviewerWorkspaceParityResult {
  const parity = compareReviewerWorkspaceManifests(workspaces, dockerfile);
  const diagnostics = [
    ...(parity.missing.length > 0
      ? [`Reviewer Dockerfile is missing workspace manifests: ${parity.missing.join(', ')}`]
      : []),
    ...(parity.stale.length > 0
      ? [`Reviewer Dockerfile has stale workspace manifests: ${parity.stale.join(', ')}`]
      : []),
  ];
  return { ...parity, exitCode: diagnostics.length === 0 ? 0 : 1, diagnostics };
}
