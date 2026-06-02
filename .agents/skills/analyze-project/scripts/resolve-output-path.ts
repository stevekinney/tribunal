#!/usr/bin/env bun

import { existsSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { isIncludedPath } from '../../shared/path-filter.js';

type ArtifactKind = 'project-context' | 'authoring-prompt';

interface CliOptions {
  kind: ArtifactKind;
  output?: string;
  cwd: string;
}

function parseArgs(argv: string[]): CliOptions {
  let kind: ArtifactKind = 'project-context';
  let output: string | undefined;
  let cwd = process.cwd();

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === '--kind') {
      const value = argv[index + 1];
      if (value === 'project-context' || value === 'authoring-prompt') {
        kind = value;
        index += 1;
        continue;
      }
      throw new Error('Invalid --kind. Use project-context or authoring-prompt.');
    }

    if (argument === '--output') {
      output = argv[index + 1];
      if (!output) {
        throw new Error('Missing value for --output.');
      }
      index += 1;
      continue;
    }

    if (argument === '--cwd') {
      const value = argv[index + 1];
      if (!value) {
        throw new Error('Missing value for --cwd.');
      }
      cwd = resolve(value);
      index += 1;
      continue;
    }
  }

  return { kind, output, cwd };
}

function artifactBaseName(kind: ArtifactKind): string {
  if (kind === 'project-context') {
    return 'project-context.md';
  }

  return 'multi-agent-plan-authoring-prompt.md';
}

function pickPreferredPath(paths: string[]): string | undefined {
  if (paths.length === 0) {
    return undefined;
  }

  const scoredPaths = paths.map((path) => {
    const depth = path.split('/').length;

    let score = 10;
    if (
      path === '.claude/project-context.md' ||
      path === '.claude/multi-agent-plan-authoring-prompt.md'
    ) {
      score = 100;
    } else if (path.startsWith('.claude/')) {
      score = 90;
    } else if (path.startsWith('documentation/')) {
      score = 80;
    } else if (path.startsWith('docs/')) {
      score = 70;
    } else if (path === 'project-context.md' || path === 'multi-agent-plan-authoring-prompt.md') {
      score = 60;
    }

    return { path, score, depth };
  });

  scoredPaths.sort((leftPath, rightPath) => {
    if (leftPath.score !== rightPath.score) {
      return rightPath.score - leftPath.score;
    }

    if (leftPath.depth !== rightPath.depth) {
      return leftPath.depth - rightPath.depth;
    }

    return leftPath.path.localeCompare(rightPath.path);
  });

  return scoredPaths[0]?.path;
}

async function findExistingArtifactPath(
  kind: ArtifactKind,
  cwd: string,
): Promise<string | undefined> {
  const basename = artifactBaseName(kind);
  const glob = new Bun.Glob(`**/${basename}`);

  const paths = await Array.fromAsync(glob.scan({ cwd, dot: true, onlyFiles: true }));
  const includedPaths = paths
    .filter(isIncludedPath)
    .sort((leftPath, rightPath) => leftPath.localeCompare(rightPath));

  return pickPreferredPath(includedPaths);
}

function chooseDefaultDirectory(cwd: string): string {
  if (existsSync(resolve(cwd, '.claude'))) {
    return '.claude';
  }

  if (existsSync(resolve(cwd, 'documentation'))) {
    return 'documentation';
  }

  if (existsSync(resolve(cwd, 'docs'))) {
    return 'docs';
  }

  return '.';
}

function toPrintablePath(cwd: string, absolutePath: string): string {
  const relativePath = relative(cwd, absolutePath);

  if (relativePath.length === 0) {
    return '.';
  }

  if (relativePath.startsWith('..')) {
    return absolutePath;
  }

  return relativePath;
}

async function resolveOutputPath(options: CliOptions): Promise<string> {
  if (options.output) {
    return toPrintablePath(options.cwd, resolve(options.cwd, options.output));
  }

  const existingPath = await findExistingArtifactPath(options.kind, options.cwd);
  if (existingPath) {
    return existingPath;
  }

  const defaultDirectory = chooseDefaultDirectory(options.cwd);
  const basename = artifactBaseName(options.kind);

  if (defaultDirectory === '.') {
    return basename;
  }

  return `${defaultDirectory}/${basename}`;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const outputPath = await resolveOutputPath(options);
  console.log(outputPath);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
