#!/usr/bin/env bun
/**
 * Assert the Turborepo invariants that, when broken, still produce green
 * checks and `>>> FULL TURBO`. See `.claude/rules/turborepo.md` for why each
 * one exists.
 *
 * All filesystem access lives here; the rules themselves are pure functions in
 * `lib/turbo-configuration-validation.ts`, which is covered by the 100% gate.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { parseJsonC } from './lib/parse-jsonc.js';
import { resolveRepositoryRoot } from './lib/repository-root.js';
import {
  validateTurboConfiguration,
  type TurboConfiguration,
  type WorkspacePackage,
} from './lib/turbo-configuration-validation.js';

const repositoryRoot = resolveRepositoryRoot();

function readJsonC<T>(absolutePath: string): T | undefined {
  if (!existsSync(absolutePath)) return undefined;

  return parseJsonC<T>(readFileSync(absolutePath, 'utf-8'));
}

/** Expand the `workspaces` globs in the root `package.json` to directories. */
function findWorkspaceDirectories(workspaceGlobs: string[]): string[] {
  const directories = new Set<string>();

  for (const workspaceGlob of workspaceGlobs) {
    const glob = new Bun.Glob(`${workspaceGlob}/package.json`);
    for (const match of glob.scanSync({ cwd: repositoryRoot, onlyFiles: true })) {
      directories.add(dirname(match));
    }
  }

  return [...directories].sort();
}

/** SvelteKit's adapter is chosen by which package `svelte.config.js` imports. */
function readSvelteKitAdapter(packageDirectory: string): string | undefined {
  const configurationPath = resolve(repositoryRoot, packageDirectory, 'svelte.config.js');
  if (!existsSync(configurationPath)) return undefined;

  const source = readFileSync(configurationPath, 'utf-8');

  return source.match(/from\s+['"](@sveltejs\/adapter-[a-z-]+)['"]/)?.[1];
}

function readTypescriptOutputDirectory(packageDirectory: string): string | undefined {
  const tsconfig = readJsonC<{ compilerOptions?: { outDir?: string } }>(
    resolve(repositoryRoot, packageDirectory, 'tsconfig.json'),
  );

  return tsconfig?.compilerOptions?.outDir;
}

function collectWorkspacePackages(workspaceGlobs: string[]): WorkspacePackage[] {
  return findWorkspaceDirectories(workspaceGlobs).map((directory) => {
    const manifest = readJsonC<{ name?: string; scripts?: Record<string, string> }>(
      resolve(repositoryRoot, directory, 'package.json'),
    );

    return {
      name: manifest?.name ?? directory,
      directory,
      scripts: manifest?.scripts ?? {},
      turboConfiguration: readJsonC<TurboConfiguration>(
        resolve(repositoryRoot, directory, 'turbo.json'),
      ),
      typescriptOutputDirectory: readTypescriptOutputDirectory(directory),
      svelteKitAdapter: readSvelteKitAdapter(directory),
    };
  });
}

function main(): void {
  const rootManifest = readJsonC<{ workspaces?: string[] }>(join(repositoryRoot, 'package.json'));
  const rootConfiguration = readJsonC<TurboConfiguration>(join(repositoryRoot, 'turbo.json'));

  if (!rootConfiguration) {
    console.error('Turborepo validation failed: no turbo.json at the repository root.');
    process.exit(1);
  }

  const workspacePackages = collectWorkspacePackages(rootManifest?.workspaces ?? []);
  const errors = validateTurboConfiguration(rootConfiguration, workspacePackages);

  if (errors.length > 0) {
    console.error('Turborepo configuration validation failed:');
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    console.error('\nSee .claude/rules/turborepo.md for why each rule exists.');
    process.exit(1);
  }

  console.log(
    `Turborepo configuration validation passed (${workspacePackages.length} packages checked).`,
  );
}

main();
