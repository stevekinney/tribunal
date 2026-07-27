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
const REQUIRED_ROOT_GATE_PATTERNS = ['.github/', 'documentation/', '*.md', '*.json'] as const;

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
    const adapterDirectory =
      SVELTEKIT_ADAPTER_OUTPUT_DIRECTORIES[workspacePackage.svelteKitAdapter];
    if (adapterDirectory) {
      directories.add(adapterDirectory);
    }
  }

  return [...directories];
}

function normalizeDirectory(value: string): string {
  return value.replace(/^\.\//, '').replace(/\/+$/, '');
}

/** Does any declared output glob capture files written under `directory`? */
export function outputsCoverDirectory(outputs: string[], directory: string): boolean {
  return outputs.some((output) => {
    const normalized = normalizeDirectory(output.replace(/\/?\*+$/, ''));
    return normalized === directory || directory.startsWith(`${normalized}/`);
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
    .map((output) => normalizeDirectory(output.replace(/\/?\*+$/, '')))
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

/** A cached write-task is skipped on a hit, so the files are never rewritten. */
export function validateWriteTasksAreUncached(configuration: TurboConfiguration): string[] {
  return Object.entries(configuration.tasks ?? {})
    .filter(([taskName, task]) => WRITE_TASK_PATTERN.test(taskName) && task.cache !== false)
    .map(
      ([taskName]) =>
        `turbo.json: task \`${taskName}\` rewrites files in place but is cacheable. A cache hit skips the rewrite. Set \`"cache": false\`.`,
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

  const coveredInputs = rootGateTasks.flatMap(([, task]) => task.inputs ?? []);

  return REQUIRED_ROOT_GATE_PATTERNS.filter(
    (pattern) => !coveredInputs.some((input) => input.startsWith(pattern)),
  ).map(
    (pattern) =>
      `turbo.json: no root task declares inputs covering \`${pattern}\`, so changes there are invisible to every gate.`,
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
    ...validateRootFilesAreGated(rootConfiguration),
  ];
}
