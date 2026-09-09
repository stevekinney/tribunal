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

/**
 * A Turborepo env declaration is a microsyntax, not a literal name: a `*` is a
 * wildcard (`MCP_*` covers `MCP_ENABLED`) and a leading `!` negates (excludes a
 * match). Exact matching would both miss a variable a wildcard hashes and
 * wrongly report a wildcard-covered variable as undeclared.
 *
 * Turborepo also supports a leading `\` to escape a literal `!`/`*`, but that is
 * deliberately unsupported here: `!` and `*` are the microsyntax operators, and
 * an escape only matters for an env variable whose name begins with one. Valid
 * environment variable names match `[A-Za-z_][A-Za-z0-9_]*` and so begin with
 * neither, leaving the escape no reachable use case in a turbo.json.
 */
function environmentPatternToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`);
}

/** Does `key` match the declaration list, with `!` exclusions winning over inclusions? */
export function environmentDeclarationMatches(key: string, patterns: string[]): boolean {
  const inclusions: string[] = [];
  const exclusions: string[] = [];

  for (const raw of patterns) {
    if (raw.startsWith('!')) exclusions.push(raw.slice(1));
    else inclusions.push(raw);
  }

  if (exclusions.some((pattern) => environmentPatternToRegExp(pattern).test(key))) return false;
  return inclusions.some((pattern) => environmentPatternToRegExp(pattern).test(key));
}

/**
 * A package-level `turbo.json` task overrides the root task definition entirely,
 * so a package's effective `env` for a task is the package task's `env` when the
 * package defines that task (even if its `env` is absent — the override still
 * replaces the root), and the root task's `env` otherwise. Mirrors
 * `resolveTaskOutputs`.
 */
export function resolveTaskEnvironment(
  rootConfiguration: TurboConfiguration,
  workspacePackage: WorkspacePackage,
  taskName: string,
): string[] {
  const packageTasks = workspacePackage.turboConfiguration?.tasks;
  if (packageTasks && taskName in packageTasks) {
    return packageTasks[taskName].env ?? [];
  }

  return rootConfiguration.tasks?.[taskName]?.env ?? [];
}

/**
 * Every declaration list that hashes a variable into a cache key somewhere in
 * the graph, each kept separate: the global `globalEnv` list, every root task's
 * `env`, and every workspace package's effective (override-aware) task `env`.
 * `passThroughEnv` is excluded — it forwards a value without hashing it. The
 * lists stay separate so a `!` exclusion in one scope cannot cancel an inclusion
 * in another; a key is hashed if any single scope hashes it. Package-level task
 * envs are included so a runtime key added to an `applications/web/turbo.json`
 * task override is not missed.
 */
function collectHashedEnvironmentScopes(
  rootConfiguration: TurboConfiguration,
  workspacePackages: WorkspacePackage[],
): string[][] {
  const taskNames = new Set<string>(Object.keys(rootConfiguration.tasks ?? {}));
  for (const workspacePackage of workspacePackages) {
    for (const name of Object.keys(workspacePackage.turboConfiguration?.tasks ?? {})) {
      taskNames.add(name);
    }
  }

  const scopes: string[][] = [rootConfiguration.globalEnv ?? []];

  // Root task envs are the baseline for every package that does not override the
  // task (and cover the no-package case).
  for (const name of taskNames) {
    scopes.push(rootConfiguration.tasks?.[name]?.env ?? []);
  }

  // Each package's effective task env (override wins) is its own scope.
  for (const workspacePackage of workspacePackages) {
    for (const name of taskNames) {
      scopes.push(resolveTaskEnvironment(rootConfiguration, workspacePackage, name));
    }
  }

  return scopes;
}

/**
 * Every variable the web application's environment schema owns must be declared
 * in a *global* turbo env list (`globalEnv` or `globalPassThroughEnv`). The web
 * app reads these across `build`, `test`, and `dev`, so a per-task declaration
 * leaves every other task blind under strict `envMode` (Turborepo 2.x's
 * default), where a task process receives only its declared variables — the MCP
 * env surface was invisible to every task before it was declared globally
 * (TRI-55). Derived from `webEnvironmentKeys` so a newly added variable is
 * caught here rather than needing a second hand-kept list.
 */
export function validateWebEnvironmentIsDeclared(
  configuration: TurboConfiguration,
  webEnvironmentKeys: string[],
): string[] {
  // `globalEnv` and `globalPassThroughEnv` are separate scopes, so a `!`
  // exclusion in one cannot cancel an inclusion in the other; a key is declared
  // if either scope declares it.
  const globalScopes = [configuration.globalEnv ?? [], configuration.globalPassThroughEnv ?? []];

  return webEnvironmentKeys
    .filter((key) => !globalScopes.some((scope) => environmentDeclarationMatches(key, scope)))
    .map(
      (key) =>
        `turbo.json: \`${key}\` is read by the web application's environment schema but is not declared in globalEnv or globalPassThroughEnv. Turborepo's envMode defaults to strict, so it never reaches a turbo-spawned task and a change to it invalidates no cache. A per-task \`env\` is not enough — the web app reads it across build, test, and dev. Add it to globalPassThroughEnv (read at runtime via $env/dynamic/private) or globalEnv (inlined at build time).`,
    );
}

/**
 * Two dual invariants over which cache keys hash a web environment variable,
 * checked across every hashing scope (globalEnv, root task envs, and each
 * package's override-aware task env):
 *
 * - A runtime (`$env/dynamic/private`) variable must be hashed nowhere; hashing
 *   it partitions that cache by a per-environment value for no correctness
 *   benefit.
 * - A build-inlined variable must be hashed somewhere; if it drifts out of
 *   `globalEnv` into passthrough, a stale build cache is reused across its
 *   values.
 *
 * `buildInlinedKeys` is the caller-supplied set of variables the build actually
 * substitutes.
 */
export function validateWebEnvironmentHashing(
  configuration: TurboConfiguration,
  webEnvironmentKeys: string[],
  buildInlinedKeys: string[],
  workspacePackages: WorkspacePackage[] = [],
): string[] {
  const inlined = new Set(buildInlinedKeys);
  const globalEnv = configuration.globalEnv ?? [];
  const hashedScopes = collectHashedEnvironmentScopes(configuration, workspacePackages);
  const isHashedAnywhere = (key: string) =>
    hashedScopes.some((scope) => environmentDeclarationMatches(key, scope));

  const runtimeKeysHashed = webEnvironmentKeys
    .filter((key) => !inlined.has(key) && isHashedAnywhere(key))
    .map(
      (key) =>
        `turbo.json: \`${key}\` is hashed into a cache key (globalEnv or a task \`env\`), but it is read at runtime rather than inlined at build time. A per-environment value there gives each distinct value a disjoint cache. Move it to globalPassThroughEnv.`,
    );

  // A build-inlined key must be in globalEnv specifically. Only globalEnv hashes
  // into every task unconditionally; a task-level `env` (even the root's) can be
  // replaced by a package override that omits it (e.g. applications/web/turbo.json
  // overrides `build` with no `env`), leaving the build cache reusable across the
  // key's values.
  const buildKeysNotHashed = buildInlinedKeys
    .filter((key) => !environmentDeclarationMatches(key, globalEnv))
    .map(
      (key) =>
        `turbo.json: \`${key}\` is inlined into the build output but is not in globalEnv. Only globalEnv hashes it into every task unconditionally — a task-level \`env\` can be dropped by a package override, so the build cache could be reused across different ${key} values. Add it to globalEnv.`,
    );

  return [...runtimeKeysHashed, ...buildKeysNotHashed];
}

/**
 * The web application's environment surface, threaded from
 * `scripts/validate-turbo-configuration.ts`, which reads the schema's
 * `webEnvironmentKeys` and the set of build-inlined variables.
 */
export type WebEnvironmentDeclaration = {
  keys: string[];
  buildInlinedKeys: string[];
};

/** Run every rule and collect the findings. */
export function validateTurboConfiguration(
  rootConfiguration: TurboConfiguration,
  workspacePackages: WorkspacePackage[],
  webEnvironment?: WebEnvironmentDeclaration,
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
    ...(webEnvironment
      ? [
          ...validateWebEnvironmentIsDeclared(rootConfiguration, webEnvironment.keys),
          ...validateWebEnvironmentHashing(
            rootConfiguration,
            webEnvironment.keys,
            webEnvironment.buildInlinedKeys,
            workspacePackages,
          ),
        ]
      : []),
  ];
}
