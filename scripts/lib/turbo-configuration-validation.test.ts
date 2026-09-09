import { describe, expect, it } from 'vitest';

import {
  deriveBuildOutputDirectories,
  outputsCoverDirectory,
  resolveTaskEnvironment,
  resolveTaskOutputs,
  validateBuildOutputs,
  validateGlobalDependencies,
  validateGlobalEnvironmentVariables,
  environmentDeclarationMatches,
  validateRootFilesAreGated,
  validateTurboConfiguration,
  validateWebEnvironmentHashing,
  validateWebEnvironmentIsDeclared,
  validateWriteTasksAreUncached,
  type TurboConfiguration,
  type WorkspacePackage,
} from './turbo-configuration-validation';

function makePackage(overrides: Partial<WorkspacePackage> = {}): WorkspacePackage {
  return {
    name: '@tribunal/example',
    directory: 'packages/example',
    scripts: {},
    ...overrides,
  };
}

describe('deriveBuildOutputDirectories', () => {
  it('returns nothing when the package has no build script', () => {
    expect(deriveBuildOutputDirectories(makePackage())).toEqual([]);
  });

  it('reads the directory from a bun build --outdir flag', () => {
    const workspacePackage = makePackage({
      scripts: { build: 'bun build src/index.ts --outdir dist --target bun' },
    });

    expect(deriveBuildOutputDirectories(workspacePackage)).toEqual(['dist']);
  });

  it('accepts --outdir=value form and strips a leading ./', () => {
    const workspacePackage = makePackage({
      scripts: { build: 'bun build src/index.ts --outdir=./output/' },
    });

    expect(deriveBuildOutputDirectories(workspacePackage)).toEqual(['output']);
  });

  it('reads outDir from tsconfig for a tsc build', () => {
    const workspacePackage = makePackage({
      scripts: { build: 'tsc' },
      typescriptOutputDirectory: 'dist',
    });

    expect(deriveBuildOutputDirectories(workspacePackage)).toEqual(['dist']);
  });

  it('ignores a tsc build when tsconfig declares no outDir', () => {
    const workspacePackage = makePackage({ scripts: { build: 'tsc' } });

    expect(deriveBuildOutputDirectories(workspacePackage)).toEqual([]);
  });

  it('does not treat a word merely containing tsc as the compiler', () => {
    const workspacePackage = makePackage({
      scripts: { build: 'run-tscript' },
      typescriptOutputDirectory: 'dist',
    });

    expect(deriveBuildOutputDirectories(workspacePackage)).toEqual([]);
  });

  it('maps a SvelteKit adapter to the directory it writes', () => {
    const workspacePackage = makePackage({
      scripts: { build: 'svelte-kit sync && vite build' },
      svelteKitAdapter: '@sveltejs/adapter-node',
    });

    expect(deriveBuildOutputDirectories(workspacePackage)).toEqual(['build']);
  });

  it('honors an explicit adapter out directory over the adapter default', () => {
    const workspacePackage = makePackage({
      scripts: { build: 'vite build' },
      svelteKitAdapter: '@sveltejs/adapter-node',
      svelteKitAdapterOutputDirectory: 'server',
    });

    expect(deriveBuildOutputDirectories(workspacePackage)).toEqual(['server']);
  });

  it('normalizes an explicit adapter out directory', () => {
    const workspacePackage = makePackage({
      scripts: { build: 'vite build' },
      svelteKitAdapter: '@sveltejs/adapter-node',
      svelteKitAdapterOutputDirectory: './server/',
    });

    expect(deriveBuildOutputDirectories(workspacePackage)).toEqual(['server']);
  });

  it('ignores an unrecognized adapter rather than guessing', () => {
    const workspacePackage = makePackage({
      scripts: { build: 'vite build' },
      svelteKitAdapter: '@sveltejs/adapter-cloudflare',
    });

    expect(deriveBuildOutputDirectories(workspacePackage)).toEqual([]);
  });

  it('ignores a vite build with no adapter configured', () => {
    const workspacePackage = makePackage({ scripts: { build: 'vite build' } });

    expect(deriveBuildOutputDirectories(workspacePackage)).toEqual([]);
  });

  it('collects every directory a compound build script writes', () => {
    const workspacePackage = makePackage({
      scripts: { build: 'tsc && bun build src/worker.ts --outdir bundle' },
      typescriptOutputDirectory: 'dist',
    });

    expect(deriveBuildOutputDirectories(workspacePackage).sort()).toEqual(['bundle', 'dist']);
  });
});

describe('outputsCoverDirectory', () => {
  it('matches a recursive glob against its own directory', () => {
    expect(outputsCoverDirectory(['dist/**'], 'dist')).toBe(true);
  });

  it('matches a bare directory with no glob suffix', () => {
    expect(outputsCoverDirectory(['dist'], 'dist')).toBe(true);
  });

  it('treats a parent glob as covering a nested directory', () => {
    expect(outputsCoverDirectory(['.svelte-kit/**'], '.svelte-kit/output')).toBe(true);
  });

  it('rejects a directory no glob reaches', () => {
    expect(outputsCoverDirectory(['.svelte-kit/**', '.vercel/**'], 'build')).toBe(false);
  });

  it('rejects a single-level glob, which drops nested artifacts', () => {
    // SvelteKit's build/ contains client/, server/, and prerendered/.
    expect(outputsCoverDirectory(['build/*'], 'build')).toBe(false);
  });

  it('rejects a prefix glob over sibling names', () => {
    expect(outputsCoverDirectory(['build*'], 'build')).toBe(false);
  });

  it('accepts an explicitly recursive glob', () => {
    expect(outputsCoverDirectory(['build/**/*'], 'build')).toBe(true);
  });

  it('accepts a trailing-slash directory', () => {
    expect(outputsCoverDirectory(['build/'], 'build')).toBe(true);
  });

  it('rejects a bare wildcard', () => {
    expect(outputsCoverDirectory(['**'], 'build')).toBe(false);
  });

  it('rejects a merely-prefixed sibling directory', () => {
    expect(outputsCoverDirectory(['build-output/**'], 'build')).toBe(false);
  });

  it('reports no coverage when nothing is declared', () => {
    expect(outputsCoverDirectory([], 'dist')).toBe(false);
  });
});

describe('resolveTaskOutputs', () => {
  const rootConfiguration: TurboConfiguration = {
    tasks: { build: { outputs: ['dist/**'] } },
  };

  it('falls back to the root task definition', () => {
    expect(resolveTaskOutputs(rootConfiguration, makePackage(), 'build')).toEqual(['dist/**']);
  });

  it('lets a package-level turbo.json override the root definition', () => {
    const workspacePackage = makePackage({
      turboConfiguration: { tasks: { build: { outputs: ['build/**'] } } },
    });

    expect(resolveTaskOutputs(rootConfiguration, workspacePackage, 'build')).toEqual(['build/**']);
  });

  it('falls back when the package config omits outputs for the task', () => {
    const workspacePackage = makePackage({
      turboConfiguration: { tasks: { build: { cache: false } } },
    });

    expect(resolveTaskOutputs(rootConfiguration, workspacePackage, 'build')).toEqual(['dist/**']);
  });

  it('returns nothing when neither level defines the task', () => {
    expect(resolveTaskOutputs({}, makePackage(), 'build')).toEqual([]);
  });
});

describe('validateBuildOutputs', () => {
  it('accepts a package whose outputs cover what the build writes', () => {
    const errors = validateBuildOutputs({ tasks: { build: { outputs: ['dist/**'] } } }, [
      makePackage({ scripts: { build: 'tsc' }, typescriptOutputDirectory: 'dist' }),
    ]);

    expect(errors).toEqual([]);
  });

  it('catches the shipped adapter-node bug: build/ written but not declared', () => {
    const workspacePackage = makePackage({
      directory: 'applications/web',
      scripts: { build: 'svelte-kit sync && vite build' },
      svelteKitAdapter: '@sveltejs/adapter-node',
      turboConfiguration: { tasks: { build: { outputs: ['.svelte-kit/**', '.vercel/**'] } } },
    });

    const errors = validateBuildOutputs({}, [workspacePackage]);

    expect(errors).toHaveLength(2);
    expect(errors[0]).toContain('`build` writes `build/`');
    expect(errors[0]).toContain('cache hit would restore no artifact');
    expect(errors[1]).toContain('outputs declare `.vercel/`, which no adapter writes');
  });

  it('accepts the corrected adapter-node configuration', () => {
    const workspacePackage = makePackage({
      directory: 'applications/web',
      scripts: { build: 'svelte-kit sync && vite build' },
      svelteKitAdapter: '@sveltejs/adapter-node',
      turboConfiguration: { tasks: { build: { outputs: ['.svelte-kit/**', 'build/**'] } } },
    });

    expect(validateBuildOutputs({}, [workspacePackage])).toEqual([]);
  });

  it('allows .vercel outputs when the Vercel adapter is configured', () => {
    const workspacePackage = makePackage({
      scripts: { build: 'vite build' },
      svelteKitAdapter: '@sveltejs/adapter-vercel',
      turboConfiguration: { tasks: { build: { outputs: ['.vercel/**'] } } },
    });

    expect(validateBuildOutputs({}, [workspacePackage])).toEqual([]);
  });

  it('reports outputs as none declared when the task defines none', () => {
    const errors = validateBuildOutputs({}, [
      makePackage({ scripts: { build: 'tsc' }, typescriptOutputDirectory: 'dist' }),
    ]);

    expect(errors[0]).toContain('none declared');
  });

  it('skips packages that inherit a build task but define no build script', () => {
    const errors = validateBuildOutputs({ tasks: { build: { outputs: ['dist/**'] } } }, [
      makePackage({ scripts: { check: 'tsc --noEmit' } }),
    ]);

    expect(errors).toEqual([]);
  });

  it('ignores stray output globs for packages with no adapter', () => {
    const workspacePackage = makePackage({
      scripts: { build: 'tsc' },
      typescriptOutputDirectory: 'dist',
      turboConfiguration: { tasks: { build: { outputs: ['dist/**', '.vercel/**'] } } },
    });

    expect(validateBuildOutputs({}, [workspacePackage])).toEqual([]);
  });
});

describe('validateGlobalEnvironmentVariables', () => {
  it('catches the shipped bug: DATABASE_URL partitioning every cache key', () => {
    const errors = validateGlobalEnvironmentVariables({
      globalEnv: ['DATABASE_URL', 'NODE_ENV'],
    });

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('`DATABASE_URL` is in globalEnv');
    expect(errors[0]).toContain('globalPassThroughEnv');
  });

  it('accepts non-credential variables', () => {
    expect(validateGlobalEnvironmentVariables({ globalEnv: ['NODE_ENV', 'CI'] })).toEqual([]);
  });

  it('flags every credential-shaped suffix', () => {
    const errors = validateGlobalEnvironmentVariables({
      globalEnv: ['API_KEY', 'SESSION_SECRET', 'GITHUB_TOKEN', 'DB_PASSWORD', 'PG_DSN'],
    });

    expect(errors).toHaveLength(5);
  });

  it('accepts a configuration with no globalEnv at all', () => {
    expect(validateGlobalEnvironmentVariables({})).toEqual([]);
  });
});

describe('validateWriteTasksAreUncached', () => {
  it('catches a cacheable format task', () => {
    const errors = validateWriteTasksAreUncached({ tasks: { format: {} } });

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('rewrites files in place but is cacheable');
  });

  it('accepts format when it is explicitly uncached', () => {
    expect(validateWriteTasksAreUncached({ tasks: { format: { cache: false } } })).toEqual([]);
  });

  it('checks root format tasks too', () => {
    const errors = validateWriteTasksAreUncached({ tasks: { '//#format:root': {} } });

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('//#format:root');
  });

  it('leaves read-only format:check alone', () => {
    const configuration: TurboConfiguration = {
      tasks: { 'format:check': {}, '//#format:check:root': {} },
    };

    expect(validateWriteTasksAreUncached(configuration)).toEqual([]);
  });

  it('accepts a configuration with no tasks', () => {
    expect(validateWriteTasksAreUncached({})).toEqual([]);
  });

  it('names the source file so package-level overrides are identifiable', () => {
    const errors = validateWriteTasksAreUncached(
      { tasks: { format: { cache: true } } },
      'applications/web/turbo.json',
    );

    expect(errors[0]).toContain('applications/web/turbo.json');
  });
});

describe('validateGlobalDependencies', () => {
  it('accepts a configuration declaring every required root config file', () => {
    const configuration: TurboConfiguration = {
      globalDependencies: ['.prettierrc', '.prettierignore', '.oxlintrc.json'],
    };

    expect(validateGlobalDependencies(configuration)).toEqual([]);
  });

  it('reports each missing root config file', () => {
    const errors = validateGlobalDependencies({ globalDependencies: ['.prettierrc'] });

    expect(errors).toHaveLength(2);
    expect(errors[0]).toContain('.prettierignore');
    expect(errors[1]).toContain('.oxlintrc.json');
  });

  it('reports all of them when globalDependencies is absent entirely', () => {
    expect(validateGlobalDependencies({})).toHaveLength(3);
  });

  it('normalizes a leading ./ in a declared entry', () => {
    const configuration: TurboConfiguration = {
      globalDependencies: ['./.prettierrc', '.prettierignore', '.oxlintrc.json'],
    };

    expect(validateGlobalDependencies(configuration)).toEqual([]);
  });
});

describe('validateRootFilesAreGated', () => {
  const gatedInputs = [
    '.github/**/*.yml',
    '.github/**/*.md',
    'documentation/**/*.md',
    '*.md',
    '*.json',
  ];

  it('accepts a root task covering every required path', () => {
    const configuration: TurboConfiguration = {
      tasks: { '//#format:check:root': { inputs: gatedInputs } },
    };

    expect(validateRootFilesAreGated(configuration)).toEqual([]);
  });

  it('catches the shipped bug: no root task at all', () => {
    const errors = validateRootFilesAreGated({ tasks: { 'format:check': {} } });

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('no `//#` root task is defined');
  });

  it('does not let an extension-scoped input claim a whole directory', () => {
    // `.github/**/*.yml` leaves every Markdown file under .github/ ungated.
    const configuration: TurboConfiguration = {
      tasks: {
        '//#format:check:root': {
          inputs: ['.github/**/*.yml', 'documentation/**/*.md', '*.md', '*.json'],
        },
      },
    };

    const errors = validateRootFilesAreGated(configuration);

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('.github/**/*.md');
    expect(errors[0]).toContain('Extension-scoped inputs do not cover a whole directory');
  });

  it('reports each uncovered root path', () => {
    const configuration: TurboConfiguration = {
      tasks: { '//#format:check:root': { inputs: ['*.md', '*.json'] } },
    };

    expect(validateRootFilesAreGated(configuration)).toHaveLength(3);
  });

  it('treats a root task with no inputs as covering nothing', () => {
    const errors = validateRootFilesAreGated({ tasks: { '//#format:check:root': {} } });

    expect(errors).toHaveLength(5);
  });

  it('combines inputs across multiple root tasks', () => {
    const configuration: TurboConfiguration = {
      tasks: {
        '//#format:check:root': {
          inputs: ['.github/**/*.yml', '.github/**/*.md', 'documentation/**/*.md'],
        },
        '//#lint:root': { inputs: ['*.md', '*.json'] },
      },
    };

    expect(validateRootFilesAreGated(configuration)).toEqual([]);
  });

  it('reports a missing root task when the configuration has no tasks', () => {
    expect(validateRootFilesAreGated({})).toHaveLength(1);
  });
});

describe('validateTurboConfiguration', () => {
  it('passes a correct configuration', () => {
    const configuration: TurboConfiguration = {
      globalEnv: ['NODE_ENV'],
      globalPassThroughEnv: ['CI', 'DATABASE_URL'],
      globalDependencies: ['.prettierrc', '.prettierignore', '.oxlintrc.json'],
      tasks: {
        build: { outputs: ['dist/**'] },
        format: { cache: false },
        '//#format:check:root': {
          inputs: [
            '.github/**/*.yml',
            '.github/**/*.md',
            'documentation/**/*.md',
            '*.md',
            '*.json',
          ],
        },
      },
    };

    const workspacePackages = [
      makePackage({ scripts: { build: 'tsc' }, typescriptOutputDirectory: 'dist' }),
    ];

    expect(validateTurboConfiguration(configuration, workspacePackages)).toEqual([]);
  });

  it('catches a package-level turbo.json re-enabling cache on a write task', () => {
    const configuration: TurboConfiguration = {
      globalDependencies: ['.prettierrc', '.prettierignore', '.oxlintrc.json'],
      tasks: {
        format: { cache: false },
        '//#format:check:root': {
          inputs: [
            '.github/**/*.yml',
            '.github/**/*.md',
            'documentation/**/*.md',
            '*.md',
            '*.json',
          ],
        },
      },
    };

    const workspacePackages = [
      makePackage({
        directory: 'applications/web',
        turboConfiguration: { tasks: { format: { cache: true } } },
      }),
    ];

    const errors = validateTurboConfiguration(configuration, workspacePackages);

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('applications/web/turbo.json');
    expect(errors[0]).toContain('cacheable');
  });

  it('aggregates findings from every rule', () => {
    const configuration: TurboConfiguration = {
      globalEnv: ['DATABASE_URL'],
      tasks: { build: { outputs: ['.svelte-kit/**'] }, format: {} },
    };

    const workspacePackages = [
      makePackage({
        directory: 'applications/web',
        scripts: { build: 'vite build' },
        svelteKitAdapter: '@sveltejs/adapter-node',
      }),
    ];

    const errors = validateTurboConfiguration(configuration, workspacePackages);

    expect(errors.some((error) => error.includes('restore no artifact'))).toBe(true);
    expect(errors.some((error) => error.includes('globalEnv'))).toBe(true);
    expect(errors.some((error) => error.includes('cacheable'))).toBe(true);
    expect(errors.some((error) => error.includes('no `//#` root task'))).toBe(true);
  });

  it('runs the web-environment rules only when the declaration is supplied', () => {
    const configuration: TurboConfiguration = {
      globalEnv: ['NODE_ENV'],
      globalPassThroughEnv: ['CI', 'DATABASE_URL'],
      globalDependencies: ['.prettierrc', '.prettierignore', '.oxlintrc.json'],
      tasks: {
        build: { outputs: ['dist/**'] },
        format: { cache: false },
        '//#format:check:root': {
          inputs: [
            '.github/**/*.yml',
            '.github/**/*.md',
            'documentation/**/*.md',
            '*.md',
            '*.json',
          ],
        },
      },
    };
    const workspacePackages = [
      makePackage({ scripts: { build: 'tsc' }, typescriptOutputDirectory: 'dist' }),
    ];

    // MCP_ENABLED is read by the schema but declared nowhere here.
    expect(validateTurboConfiguration(configuration, workspacePackages)).toEqual([]);
    const withWebEnvironment = validateTurboConfiguration(configuration, workspacePackages, {
      keys: ['NODE_ENV', 'MCP_ENABLED'],
      buildInlinedKeys: ['NODE_ENV'],
    });
    expect(withWebEnvironment).toHaveLength(1);
    expect(withWebEnvironment[0]).toContain('MCP_ENABLED');
  });
});

describe('environmentDeclarationMatches', () => {
  it('matches an exact declaration', () => {
    expect(environmentDeclarationMatches('MCP_ENABLED', ['MCP_ENABLED'])).toBe(true);
    expect(environmentDeclarationMatches('MCP_ENABLED', ['CI'])).toBe(false);
  });

  it('matches a trailing wildcard as a prefix', () => {
    expect(environmentDeclarationMatches('MCP_ENABLED', ['MCP_*'])).toBe(true);
    expect(environmentDeclarationMatches('NODE_ENV', ['MCP_*'])).toBe(false);
  });

  it('lets a negation exclude a variable an inclusion would match', () => {
    expect(environmentDeclarationMatches('MCP_ENABLED', ['MCP_*', '!MCP_ENABLED'])).toBe(false);
    expect(environmentDeclarationMatches('MCP_SERVER_NAME', ['MCP_*', '!MCP_ENABLED'])).toBe(true);
  });
});

describe('validateWebEnvironmentIsDeclared', () => {
  const keys = ['NODE_ENV', 'MCP_ENABLED', 'MCP_SERVER_NAME'];

  it('accepts a key covered by a global wildcard declaration', () => {
    const configuration: TurboConfiguration = {
      globalEnv: ['NODE_ENV'],
      globalPassThroughEnv: ['MCP_*'],
    };

    expect(validateWebEnvironmentIsDeclared(configuration, keys)).toEqual([]);
  });

  it('passes when every key is declared in a global env list', () => {
    const configuration: TurboConfiguration = {
      globalEnv: ['NODE_ENV'],
      globalPassThroughEnv: ['MCP_ENABLED', 'MCP_SERVER_NAME'],
    };

    expect(validateWebEnvironmentIsDeclared(configuration, keys)).toEqual([]);
  });

  it('flags a key declared only in a task env, not globally (blind under strict mode)', () => {
    // A per-task declaration leaves every other web task without the variable
    // under strict envMode — the false negative Codex flagged.
    const configuration: TurboConfiguration = {
      globalEnv: ['NODE_ENV'],
      globalPassThroughEnv: ['MCP_ENABLED'],
      tasks: { test: { env: ['MCP_SERVER_NAME'], passThroughEnv: ['VITEST_*'] } },
    };

    const errors = validateWebEnvironmentIsDeclared(configuration, keys);

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('MCP_SERVER_NAME');
    expect(errors[0]).toContain('per-task');
  });

  it('flags a key declared in no global env list, naming strict envMode', () => {
    const configuration: TurboConfiguration = {
      globalEnv: ['NODE_ENV'],
      globalPassThroughEnv: ['MCP_ENABLED'],
    };

    const errors = validateWebEnvironmentIsDeclared(configuration, keys);

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('MCP_SERVER_NAME');
    expect(errors[0]).toContain('strict');
  });

  it('treats a configuration with no env lists at all as declaring nothing', () => {
    const errors = validateWebEnvironmentIsDeclared({}, ['MCP_ENABLED']);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('MCP_ENABLED');
  });
});

describe('validateWebEnvironmentHashing', () => {
  const keys = ['NODE_ENV', 'MCP_ENABLED'];

  it('allows a build-inlined key in globalEnv', () => {
    const configuration: TurboConfiguration = { globalEnv: ['NODE_ENV'] };
    expect(validateWebEnvironmentHashing(configuration, keys, ['NODE_ENV'])).toEqual([]);
  });

  it('flags a runtime key placed in globalEnv', () => {
    const configuration: TurboConfiguration = { globalEnv: ['NODE_ENV', 'MCP_ENABLED'] };
    const errors = validateWebEnvironmentHashing(configuration, keys, ['NODE_ENV']);

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('MCP_ENABLED');
    expect(errors[0]).toContain('cache key');
  });

  it('flags a runtime key hashed into a task env, not only globalEnv', () => {
    // The Medium finding: a task-level `env` hashes the value for that task.
    const configuration: TurboConfiguration = {
      globalEnv: ['NODE_ENV'],
      tasks: { test: { env: ['MCP_ENABLED'] } },
    };
    const errors = validateWebEnvironmentHashing(configuration, keys, ['NODE_ENV']);

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('MCP_ENABLED');
  });

  it('flags a runtime key hashed by a wildcard declaration', () => {
    const configuration: TurboConfiguration = { globalEnv: ['NODE_ENV', 'MCP_*'] };
    const errors = validateWebEnvironmentHashing(configuration, keys, ['NODE_ENV']);

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('MCP_ENABLED');
  });

  it('keeps negation scoped per task: an exclusion in one task does not cancel hashing in another', () => {
    // `build` hashes MCP_ENABLED via MCP_*; a `!MCP_ENABLED` in `test` must not
    // hide that build still partitions its cache on the value.
    const configuration: TurboConfiguration = {
      globalEnv: ['NODE_ENV'],
      tasks: {
        build: { env: ['MCP_*'] },
        test: { env: ['!MCP_ENABLED'] },
      },
    };
    const errors = validateWebEnvironmentHashing(configuration, keys, ['NODE_ENV']);

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('MCP_ENABLED');
  });

  it('passes when the runtime key is passed through and the build key is hashed', () => {
    const configuration: TurboConfiguration = {
      globalEnv: ['NODE_ENV'],
      globalPassThroughEnv: ['MCP_ENABLED'],
    };
    expect(validateWebEnvironmentHashing(configuration, keys, ['NODE_ENV'])).toEqual([]);
  });

  it('flags a build-inlined key that is not hashed anywhere (drifted to passthrough)', () => {
    // NODE_ENV moved out of globalEnv into passthrough: a stale build cache would
    // be reused across NODE_ENV values.
    const configuration: TurboConfiguration = { globalPassThroughEnv: ['NODE_ENV', 'MCP_ENABLED'] };
    const errors = validateWebEnvironmentHashing(configuration, keys, ['NODE_ENV']);

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('NODE_ENV');
    expect(errors[0]).toContain('build');
  });

  it('flags a runtime key hashed only in a package-level task override', () => {
    // The root does not hash MCP_ENABLED, but a package `build` override does —
    // the package-level blind spot Cursor flagged.
    const configuration: TurboConfiguration = { globalEnv: ['NODE_ENV'] };
    const workspacePackages = [
      makePackage({
        directory: 'applications/web',
        turboConfiguration: { tasks: { build: { env: ['MCP_ENABLED'] } } },
      }),
    ];
    const errors = validateWebEnvironmentHashing(
      configuration,
      keys,
      ['NODE_ENV'],
      workspacePackages,
    );

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('MCP_ENABLED');
  });
});

describe('resolveTaskEnvironment', () => {
  const root: TurboConfiguration = { tasks: { build: { env: ['ROOT_ONLY'] } } };

  it('returns the root task env when the package does not define the task', () => {
    expect(resolveTaskEnvironment(root, makePackage(), 'build')).toEqual(['ROOT_ONLY']);
  });

  it("returns the package override's env, replacing the root, when the package defines the task", () => {
    const workspacePackage = makePackage({
      turboConfiguration: { tasks: { build: { env: ['PACKAGE_ONLY'] } } },
    });
    expect(resolveTaskEnvironment(root, workspacePackage, 'build')).toEqual(['PACKAGE_ONLY']);
  });

  it('treats a package override with no env as removing the root env for that package', () => {
    const workspacePackage = makePackage({
      turboConfiguration: { tasks: { build: { outputs: ['dist/**'] } } },
    });
    expect(resolveTaskEnvironment(root, workspacePackage, 'build')).toEqual([]);
  });

  it('returns an empty list for a task neither the root nor the package defines', () => {
    expect(resolveTaskEnvironment({}, makePackage(), 'nonexistent')).toEqual([]);
  });
});
