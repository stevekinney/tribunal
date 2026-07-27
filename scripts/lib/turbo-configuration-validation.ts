/**
 * Static assertions over Turborepo configuration.
 *
 * Every rule here exists because the corresponding misconfiguration shipped and
 * was invisible: it produced green checks, cache hits, and `>>> FULL TURBO`
 * while silently doing nothing. See `.claude/rules/turborepo.md`.
 *
 * These functions are pure — they accept already-parsed configuration and
 * return error strings. All filesystem access lives in
 * `scripts/validate-turbo-configuration.ts`, which is outside this package's
 * coverage gate.
 */

export type TurboTask = {
  outputs?: string[];
  cache?: boolean;
  dependsOn?: string[];
  inputs?: string[];
  env?: string[];
  passThroughEnv?: string[];
};

export type TurboConfiguration = {
  globalEnv?: string[];
  globalPassThroughEnv?: string[];
  globalDependencies?: string[];
  tasks?: Record<string, TurboTask>;
};

export type WorkspacePackage = {
  /** Package name from `package.json`, e.g. `@tribunal/web`. */
  name: string;
  /** Repository-relative directory, e.g. `applications/web`. */
  directory: string;
  scripts: Record<string, string>;
  /** Parsed package-level `turbo.json`, when one exists. */
  turboConfiguration?: TurboConfiguration;
  /** `compilerOptions.outDir` from the package's `tsconfig.json`. */
  typescriptOutputDirectory?: string;
  /** SvelteKit adapter import specifier from `svelte.config.js`. */
  svelteKitAdapter?: string;
  /**
   * Explicit output directory passed to the adapter, e.g. `adapter({ out:
   * 'server' })`. Overrides the adapter's default.
   */
  svelteKitAdapterOutputDirectory?: string;
};

/**
 * Environment variables whose value is a credential or per-environment
 * connection string. In `globalEnv` these are hashed into every task, giving
 * each distinct value a disjoint cache namespace.
 */
const CREDENTIAL_NAME_PATTERN = /(_URL|_KEY|_SECRET|_TOKEN|_PASSWORD|_DSN|_CREDENTIALS?)$/;

/** Tasks that rewrite files in place; a cache hit would skip the rewrite. */
const WRITE_TASK_PATTERN = /(^|#)format(:root)?$/;

/**
 * Root-level paths that belong to no workspace package, and so are invisible
 * to package-scoped tasks unless a `//#` root task covers them.
 */
const REQUIRED_ROOT_GATE_PATTERNS = [
  '.github/**/*.yml',
  '.github/**/*.md',
  'documentation/**/*.md',
  '*.md',
  '*.json',
] as const;

/**
 * Root config files that govern every package's lint and format tasks but
 * live in no package. Absent from `globalDependencies`, editing them busts no
 * hash and every task returns a stale cache hit.
 */
const REQUIRED_GLOBAL_DEPENDENCIES = ['.prettierrc', '.prettierignore', '.oxlintrc.json'] as const;

/** SvelteKit adapters mapped to the directory their build writes. */
const SVELTEKIT_ADAPTER_OUTPUT_DIRECTORIES: Record<string, string> = {
  '@sveltejs/adapter-node': 'build',
  '@sveltejs/adapter-static': 'build',
  '@sveltejs/adapter-vercel': '.vercel',
  '@sveltejs/adapter-auto': 'build',
};

/**
 * Derive the directories a package's `build` script actually writes, by
 * reading the build tool's own configuration rather than trusting `outputs`.
 */
export function deriveBuildOutputDirectories(workspacePackage: WorkspacePackage): string[] {
  const buildScript = workspacePackage.scripts.build;
  if (!buildScript) return [];

  const directories = new Set<string>();

  const bunOutputDirectory = buildScript.match(/--outdir[= ]+(\S+)/)?.[1];
  if (bunOutputDirectory) {
    directories.add(normalizeDirectory(bunOutputDirectory));
  }

  if (/(^|\s|&&)\s*tsc(\s|$)/.test(buildScript) && workspacePackage.typescriptOutputDirectory) {
    directories.add(normalizeDirectory(workspacePackage.typescriptOutputDirectory));
  }

  if (/vite build/.test(buildScript) && workspacePackage.svelteKitAdapter) {
    // An explicit `adapter({ out: '…' })` wins over the adapter's default.
    const adapterDirectory =
      workspacePackage.svelteKitAdapterOutputDirectory ??
      SVELTEKIT_ADAPTER_OUTPUT_DIRECTORIES[workspacePackage.svelteKitAdapter];
    if (adapterDirectory) {
      directories.add(normalizeDirectory(adapterDirectory));
    }
  }

  return [...directories];
}

function normalizeDirectory(value: string): string {
  return value.replace(/^\.\//, '').replace(/\/+$/, '');
}

/**
 * The directory an output glob is rooted at, ignoring its wildcard suffix.
 * `dist/**` and `dist/*` both root at `dist`.
 */
function outputGlobBaseDirectory(output: string): string {
  return normalizeDirectory(normalizeDirectory(output).replace(/\/?\*+(\/\*+)*$/, ''));
}

/**
 * Does any declared output glob capture every file written under `directory`?
 *
 * Only an exact directory or a recursive `directory/**` glob qualifies. A
 * single-level `directory/*` matches immediate children but silently drops
 * nested artifacts — SvelteKit's `build/` has `client/`, `server/`, and
 * `prerendered/` beneath it — so it is not coverage. `directory*` is a prefix
 * glob over sibling names, not that directory at all.
 */
export function outputsCoverDirectory(outputs: string[], directory: string): boolean {
  return outputs.some((output) => {
    const normalized = normalizeDirectory(output);
    if (normalized === directory) return true;

    const recursiveBase = normalized.match(/^(.+?)\/\*\*(?:\/\*+)?$/)?.[1];
    if (!recursiveBase) return false;

    return recursiveBase === directory || directory.startsWith(`${recursiveBase}/`);
  });
}

/** Package-level `turbo.json` overrides the root task definition entirely. */
export function resolveTaskOutputs(
  rootConfiguration: TurboConfiguration,
  workspacePackage: WorkspacePackage,
  taskName: string,
): string[] {
  const packageTask = workspacePackage.turboConfiguration?.tasks?.[taskName];
  if (packageTask?.outputs) return packageTask.outputs;

  return rootConfiguration.tasks?.[taskName]?.outputs ?? [];
}

/**
 * A cache hit restores exactly the declared `outputs` and nothing else. When
 * the glob misses a directory the command writes, the task reports success and
 * produces no artifact — the failure that shipped in `applications/web`.
 */
export function validateBuildOutputs(
  rootConfiguration: TurboConfiguration,
  workspacePackages: WorkspacePackage[],
): string[] {
  const errors: string[] = [];

  for (const workspacePackage of workspacePackages) {
    const expectedDirectories = deriveBuildOutputDirectories(workspacePackage);
    if (expectedDirectories.length === 0) continue;

    const outputs = resolveTaskOutputs(rootConfiguration, workspacePackage, 'build');

    for (const directory of expectedDirectories) {
      if (!outputsCoverDirectory(outputs, directory)) {
        errors.push(
          `${workspacePackage.directory}: \`build\` writes \`${directory}/\` but the task's outputs (${formatList(outputs)}) do not cover it. A cache hit would restore no artifact.`,
        );
      }
    }

    errors.push(...findUnreachableAdapterOutputs(workspacePackage, outputs, expectedDirectories));
  }

  return errors;
}

/**
 * Flag output globs pointing at a directory no configured adapter writes —
 * the `.vercel/**` glob left behind on a project that uses `adapter-node`.
 */
function findUnreachableAdapterOutputs(
  workspacePackage: WorkspacePackage,
  outputs: string[],
  expectedDirectories: string[],
): string[] {
  if (!workspacePackage.svelteKitAdapter) return [];

  const adapterDirectories = new Set(Object.values(SVELTEKIT_ADAPTER_OUTPUT_DIRECTORIES));

  return outputs
    .map(outputGlobBaseDirectory)
    .filter(
      (directory) => adapterDirectories.has(directory) && !expectedDirectories.includes(directory),
    )
    .map(
      (directory) =>
        `${workspacePackage.directory}: outputs declare \`${directory}/\`, which no adapter writes (configured adapter is \`${workspacePackage.svelteKitAdapter}\`). Stale glob.`,
    );
}

/**
 * `globalEnv` hashes a variable's value into every task, so a per-developer or
 * per-environment credential partitions the cache instead of sharing it.
 */
export function validateGlobalEnvironmentVariables(configuration: TurboConfiguration): string[] {
  return (configuration.globalEnv ?? [])
    .filter((variableName) => CREDENTIAL_NAME_PATTERN.test(variableName))
    .map(
      (variableName) =>
        `turbo.json: \`${variableName}\` is in globalEnv, so its value is hashed into every task and each distinct value gets a disjoint cache. Move it to globalPassThroughEnv unless it is genuinely inlined at build time.`,
    );
}

/**
 * A cached write-task is skipped on a hit, so the files are never rewritten.
 *
 * `source` names the file, because a package-level `turbo.json` can re-enable
 * caching for a task the root correctly marks uncached.
 */
export function validateWriteTasksAreUncached(
  configuration: TurboConfiguration,
  source = 'turbo.json',
): string[] {
  return Object.entries(configuration.tasks ?? {})
    .filter(([taskName, task]) => WRITE_TASK_PATTERN.test(taskName) && task.cache !== false)
    .map(
      ([taskName]) =>
        `${source}: task \`${taskName}\` rewrites files in place but is cacheable. A cache hit skips the rewrite. Set \`"cache": false\`.`,
    );
}

/**
 * Root config files govern every package's lint and format tasks, so they must
 * be hashed globally or edits to them return stale cache hits everywhere.
 */
export function validateGlobalDependencies(configuration: TurboConfiguration): string[] {
  const declared = configuration.globalDependencies ?? [];

  return REQUIRED_GLOBAL_DEPENDENCIES.filter(
    (required) => !declared.some((entry) => normalizeDirectory(entry) === required),
  ).map(
    (required) =>
      `turbo.json: \`${required}\` governs every package's lint/format task but is not in globalDependencies, so editing it busts no hash and every task returns a stale cache hit.`,
  );
}

/**
 * Package-scoped tasks only ever see files inside their own package, so
 * root-level files need an explicit `//#` task or no gate examines them.
 */
export function validateRootFilesAreGated(configuration: TurboConfiguration): string[] {
  const rootGateTasks = Object.entries(configuration.tasks ?? {}).filter(([taskName]) =>
    taskName.startsWith('//#'),
  );

  if (rootGateTasks.length === 0) {
    return [
      'turbo.json: no `//#` root task is defined, so no gate examines `.github/**`, root Markdown, or `documentation/**` — files that belong to no package.',
    ];
  }

  const coveredInputs = new Set(rootGateTasks.flatMap(([, task]) => task.inputs ?? []));

  // Exact match, not prefix. A prefix test lets `.github/**/*.yml` claim all of
  // `.github/`, leaving every Markdown file there ungated while the check
  // reports success — the blind-gate failure this validator exists to catch.
  return REQUIRED_ROOT_GATE_PATTERNS.filter((pattern) => !coveredInputs.has(pattern)).map(
    (pattern) =>
      `turbo.json: no root task declares the input \`${pattern}\`, so files matching it are invisible to every gate. Extension-scoped inputs do not cover a whole directory.`,
  );
}

function formatList(values: string[]): string {
  if (values.length === 0) return 'none declared';

  return values.map((value) => `\`${value}\``).join(', ');
}

/** Run every rule and collect the findings. */
export function validateTurboConfiguration(
  rootConfiguration: TurboConfiguration,
  workspacePackages: WorkspacePackage[],
): string[] {
  return [
    ...validateBuildOutputs(rootConfiguration, workspacePackages),
    ...validateGlobalEnvironmentVariables(rootConfiguration),
    ...validateWriteTasksAreUncached(rootConfiguration),
    ...workspacePackages.flatMap((workspacePackage) =>
      workspacePackage.turboConfiguration
        ? validateWriteTasksAreUncached(
            workspacePackage.turboConfiguration,
            `${workspacePackage.directory}/turbo.json`,
          )
        : [],
    ),
    ...validateGlobalDependencies(rootConfiguration),
    ...validateRootFilesAreGated(rootConfiguration),
  ];
}
