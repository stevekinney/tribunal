import { describe, expect, it } from 'vitest';
import {
  compareReviewerWorkspaceManifests,
  reviewerWorkspaceParityResult,
} from './reviewer-workspace-parity';

const workspaces = [
  'applications/web',
  'packages/agents',
  'packages/database',
  'runner',
  'scripts',
];

function dockerfileFor(entries: readonly string[]): string {
  return [
    ...entries.map((workspace) => `COPY ${workspace}/package.json ./${workspace}/package.json`),
    'RUN bun install --production --frozen-lockfile',
  ].join('\n');
}

describe('compareReviewerWorkspaceManifests', () => {
  it('accepts exact parity between declared workspaces and copied manifests', () => {
    expect(compareReviewerWorkspaceManifests(workspaces, dockerfileFor(workspaces))).toEqual({
      missing: [],
      stale: [],
    });
  });

  it('reports a root workspace missing from the reviewer Dockerfile', () => {
    expect(
      compareReviewerWorkspaceManifests(
        workspaces,
        dockerfileFor(workspaces.filter((workspace) => workspace !== 'packages/database')),
      ),
    ).toEqual({ missing: ['packages/database'], stale: [] });
  });

  it('reports a Dockerfile manifest entry for a workspace that no longer exists', () => {
    expect(
      compareReviewerWorkspaceManifests(
        workspaces,
        dockerfileFor([...workspaces, 'packages/removed']),
      ),
    ).toEqual({ missing: [], stale: ['packages/removed'] });
  });

  it('ignores manifests copied after installation or to the wrong destination', () => {
    const dockerfile = [
      'COPY applications/web/package.json ./applications/web/package.json',
      'COPY packages/agents/package.json ./wrong/package.json',
      'RUN bun install --production --frozen-lockfile',
      'COPY packages/database/package.json ./packages/database/package.json',
    ].join('\n');

    expect(
      compareReviewerWorkspaceManifests(
        ['applications/web', 'packages/agents', 'packages/database'],
        dockerfile,
      ),
    ).toEqual({ missing: ['packages/agents', 'packages/database'], stale: [] });
  });

  it('returns process outcomes and actionable diagnostics for parity and drift', () => {
    expect(reviewerWorkspaceParityResult(workspaces, dockerfileFor(workspaces))).toMatchObject({
      exitCode: 0,
      diagnostics: [],
    });
    expect(
      reviewerWorkspaceParityResult(
        workspaces,
        dockerfileFor(workspaces.filter((workspace) => workspace !== 'packages/database')),
      ),
    ).toMatchObject({
      exitCode: 1,
      diagnostics: ['Reviewer Dockerfile is missing workspace manifests: packages/database'],
    });
    expect(
      reviewerWorkspaceParityResult(workspaces, dockerfileFor([...workspaces, 'packages/removed'])),
    ).toMatchObject({
      exitCode: 1,
      diagnostics: ['Reviewer Dockerfile has stale workspace manifests: packages/removed'],
    });
  });
});
