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
import { dirname, join, relative, resolve } from 'node:path';

import { parseJsonC } from './lib/parse-jsonc';
import { resolveRepositoryRoot } from './lib/repository-root';
import {
  validateTurboConfiguration,
  type TurboConfiguration,
  type WorkspacePackage,
} from './lib/turbo-configuration-validation';

const repositoryRoot = resolveRepositoryRoot();

function readJsonC<T>(absolutePath: string): T | undefined {
  if (!existsSync(absolutePath)) return undefined;

  try {
    return parseJsonC<T>(readFileSync(absolutePath, 'utf-8'));
  } catch (cause) {
    // A bare JSON.parse message names no file, which makes a CI or pre-commit
    // failure needlessly hard to act on.
    const reason = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`Failed to parse ${relative(repositoryRoot, absolutePath)}: ${reason}`, {
      cause,
    });
  }
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

/**
 * SvelteKit's adapter is chosen by which package `svelte.config.js` imports,
 * and its output directory can be overridden with `adapter({ out: '…' })`.
 */
function readSvelteKitAdapter(packageDirectory: string): {
  adapter?: string;
  outputDirectory?: string;
} {
  const configurationPath = resolve(repositoryRoot, packageDirectory, 'svelte.config.js');
  if (!existsSync(configurationPath)) return {};

  const source = readFileSync(configurationPath, 'utf-8');

  return {
    adapter: source.match(/from\s+['"](@sveltejs\/adapter-[a-z-]+)['"]/)?.[1],
    outputDirectory: source.match(/adapter\(\s*\{[^}]*\bout\s*:\s*['"]([^'"]+)['"]/)?.[1],
  };
}

/**
 * Resolve the tsconfig the build actually compiles. `tsc -p tsconfig.build.json`
 * is common, and reading the default `tsconfig.json` would miss its `outDir`
 * and silently skip the package.
 */
function readTypescriptOutputDirectory(
  packageDirectory: string,
  buildScript: string | undefined,
): string | undefined {
  const projectFile = buildScript?.match(/(?:-p|--project)[= ]+(\S+)/)?.[1] ?? 'tsconfig.json';

  const tsconfig = readJsonC<{ compilerOptions?: { outDir?: string }; extends?: string }>(
    resolve(repositoryRoot, packageDirectory, projectFile),
  );

  if (tsconfig?.compilerOptions?.outDir) return tsconfig.compilerOptions.outDir;

  // A build-specific config commonly sets only overrides and inherits outDir
  // from a sibling config in the same package.
  if (tsconfig?.extends?.startsWith('.')) {
    return readJsonC<{ compilerOptions?: { outDir?: string } }>(
      resolve(repositoryRoot, packageDirectory, tsconfig.extends),
    )?.compilerOptions?.outDir;
  }

  return undefined;
}

function collectWorkspacePackages(workspaceGlobs: string[]): WorkspacePackage[] {
  return findWorkspaceDirectories(workspaceGlobs).map((directory) => {
    const manifest = readJsonC<{ name?: string; scripts?: Record<string, string> }>(
      resolve(repositoryRoot, directory, 'package.json'),
    );
    const scripts = manifest?.scripts ?? {};
    const svelteKit = readSvelteKitAdapter(directory);

    return {
      name: manifest?.name ?? directory,
      directory,
      scripts,
      turboConfiguration: readJsonC<TurboConfiguration>(
        resolve(repositoryRoot, directory, 'turbo.json'),
      ),
      typescriptOutputDirectory: readTypescriptOutputDirectory(directory, scripts.build),
      svelteKitAdapter: svelteKit.adapter,
      svelteKitAdapterOutputDirectory: svelteKit.outputDirectory,
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
