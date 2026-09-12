import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { McpContext } from '@lostgradient/mcp';
import { tribunalMcpOperations, tribunalMcpRegistry } from './registry';

const fetchGuard = vi.hoisted(() => {
  const guardedFetch = vi.fn(async () => new Response(JSON.stringify({ ok: true })));
  vi.stubGlobal('fetch', guardedFetch);
  return { guardedFetch };
});

const repository = {
  id: 9001,
  owner: 'lost-gradient',
  name: 'tribunal',
  defaultBranch: 'main',
  latestCommit: 'abc123',
  installationAccount: 'lost-gradient',
  installationId: 7001,
};

const pullRequest = {
  number: 412,
  title: 'Outbound fetch fixture pull request',
  state: 'open' as const,
  isDraft: false,
  authorLogin: 'contributor',
  headRef: 'feature',
  headSha: 'abc123',
  baseRef: 'main',
  htmlUrl: 'https://github.com/lost-gradient/tribunal/pull/412',
  updatedAt: '2026-08-01T00:00:00.000Z',
  mergedAt: null,
};

const reviewRun = {
  id: 'run-1',
  status: 'posted',
  repositoryId: 9001,
  repositoryOwner: 'lost-gradient',
  repositoryName: 'tribunal',
  pullRequestNumber: 412,
  costEstimateUsd: 1.25,
  startedAt: '2026-08-01T00:00:00.000Z',
  finishedAt: '2026-08-01T00:05:00.000Z',
};

const finding = {
  id: 'finding-1',
  runId: 'run-1',
  repositoryId: 9001,
  repositoryOwner: 'lost-gradient',
  repositoryName: 'tribunal',
  pullRequestNumber: 412,
  path: 'src/example.ts',
  startLine: 10,
  endLine: 12,
  side: 'RIGHT',
  severity: 'warning',
  title: 'Outbound fetch fixture finding',
  body: 'Synthetic finding text.',
  suggestion: null,
  verificationStatus: 'verified',
  createdAt: '2026-08-01T00:00:00.000Z',
};

const costEvent = {
  occurredAt: '2026-08-01T00:00:00.000Z',
  amountUsd: 2.5,
  source: 'estimate' as const,
  repositoryId: 9001,
  repositoryOwner: 'lost-gradient',
  repositoryName: 'tribunal',
  agentSlug: 'security',
};

vi.mock('./readers/repository-reader', () => ({
  listAccessibleRepositories: vi.fn(async () => ({ ok: true, repositories: [repository] })),
  findAccessibleRepository: vi.fn(async () => ({ ok: true, repository })),
  findAccessibleRepositoriesByName: vi.fn(async () => ({ ok: true, matches: [repository] })),
}));

vi.mock('./readers/pull-request-reader', () => ({
  listRepositoryPullRequests: vi.fn(async () => ({
    ok: true,
    repositoryId: 9001,
    pullRequests: [pullRequest],
    page: 1,
    perPage: 25,
    hasNextPage: false,
  })),
  getRepositoryPullRequest: vi.fn(async () => ({
    ok: true,
    repositoryId: 9001,
    pullRequest: {
      ...pullRequest,
      description: 'Synthetic description.',
      additions: 10,
      deletions: 2,
      changedFiles: 3,
      isMerged: false,
      commentCount: 1,
      reviewCommentCount: 0,
      commitCount: 2,
      operationalState: null,
    },
  })),
}));

vi.mock('./readers/review-run-reader', () => ({
  listReviewRuns: vi.fn(async () => ({ items: [reviewRun], limit: 25, offset: 0, hasMore: false })),
  getReviewRun: vi.fn(async () => reviewRun),
}));

vi.mock('./readers/finding-reader', () => ({
  listReviewFindings: vi.fn(async () => ({
    items: [finding],
    limit: 25,
    offset: 0,
    hasMore: false,
  })),
  getReviewFinding: vi.fn(async () => finding),
}));

vi.mock('./readers/cost-event-reader', () => ({
  listCostEvents: vi.fn(async () => ({ items: [costEvent], limit: 25, offset: 0, hasMore: false })),
  summarizeCostEvents: vi.fn(async () => ({
    source: 'estimate',
    windowDays: 30,
    since: '2026-07-02T00:00:00.000Z',
    eventCount: 1,
    totalUsd: 2.5,
    byRepository: [{ repositoryId: 9001, label: 'lost-gradient/tribunal', amountUsd: 2.5 }],
    byAgent: [{ label: 'security', amountUsd: 2.5 }],
  })),
}));

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const sourceRoots = ['registry.ts', 'tools', 'resources', 'conformance-fixture.ts'].map((path) =>
  resolve(moduleDirectory, path),
);
const allowedExternalRuntimeImports = ['$env/dynamic/private', '@lostgradient/mcp', 'zod'];
const sourceModuleRoot = `${moduleDirectory}/`;
const readerBoundaryRoot = resolve(moduleDirectory, 'readers') + '/';
const librarySourceRoot = resolve(moduleDirectory, '../..');

type ProductionToolName = keyof typeof tribunalMcpOperations;
type RegisteredToolName = ProductionToolName | 'conformance_echo';

const toolSamples = {
  list_repositories: { limit: 25, offset: 0 },
  get_repository: { repositoryId: 9001 },
  list_pull_requests: { repositoryId: 9001, state: 'open', page: 1, perPage: 25 },
  get_pull_request: { repositoryId: 9001, pullRequestNumber: 412 },
  list_review_runs: { limit: 25, offset: 0 },
  get_review_run: { runId: 'run-1' },
  list_review_findings: { limit: 25, offset: 0 },
  get_review_finding: { findingId: 'finding-1' },
  list_cost_events: { limit: 25, offset: 0 },
  get_cost_summary: { source: 'estimate', windowDays: 30 },
  conformance_echo: { label: 'outbound-fetch' },
} satisfies Record<RegisteredToolName, Record<string, unknown>>;

function context(): McpContext {
  return {
    userId: '7',
    user: {
      id: '7',
      email: 'outbound-fetch@example.com',
      name: 'Outbound Fetch',
      image: null,
      role: 'user',
    },
    signal: new AbortController().signal,
  };
}

function sortedRegisteredTools() {
  return [...tribunalMcpRegistry.tools, ...(tribunalMcpRegistry.conformanceOnlyTools ?? [])].sort(
    (left, right) => {
      if (left.name === right.name) return 0;
      return left.name < right.name ? -1 : 1;
    },
  );
}

function listTypeScriptSources(path: string): string[] {
  if (extname(path) === '.ts') return [path];

  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = resolve(path, entry.name);
    if (entry.isDirectory()) return listTypeScriptSources(entryPath);
    if (!entry.isFile() || !entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts')) {
      return [];
    }
    return [entryPath];
  });
}

function parseSourceFile(sourcePath: string): ts.SourceFile {
  return ts.createSourceFile(
    sourcePath,
    readFileSync(sourcePath, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
}

function relativeSourcePath(sourcePath: string): string {
  return sourcePath.slice(sourceModuleRoot.length);
}

function sourceLocation(sourceFile: ts.SourceFile, node: ts.Node): string {
  const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return `${relativeSourcePath(sourceFile.fileName)}:${position.line + 1}:${position.character + 1}`;
}

function resolveLocalModule(
  specifier: string,
  sourcePath: string,
  sourceFile: ts.SourceFile,
  node: ts.Node,
): { modules: string[]; problems: string[] } {
  const isRelativeSpecifier = specifier.startsWith('./') || specifier.startsWith('../');
  const isLibrarySpecifier = specifier.startsWith('$lib/');

  if (!isRelativeSpecifier && !isLibrarySpecifier) {
    return allowedExternalRuntimeImports.includes(specifier)
      ? { modules: [], problems: [] }
      : {
          modules: [],
          problems: [
            `${sourceLocation(sourceFile, node)} unknown external runtime import: ${specifier}`,
          ],
        };
  }

  const importPath = isLibrarySpecifier
    ? resolve(librarySourceRoot, specifier.slice('$lib/'.length))
    : resolve(dirname(sourcePath), specifier);
  const modules = [importPath, `${importPath}.ts`, resolve(importPath, 'index.ts')]
    .filter((candidate) => extname(candidate) === '.ts')
    .filter((candidate) => existsSync(candidate))
    .filter((importPath) => !importPath.endsWith('.test.ts'));

  if (modules.some((modulePath) => modulePath.startsWith(readerBoundaryRoot))) {
    return { modules: [], problems: [] };
  }

  if (modules.length === 0) {
    return {
      modules: [],
      problems: [`${sourceLocation(sourceFile, node)} unresolved local import: ${specifier}`],
    };
  }

  const outsideBoundary = modules.filter((modulePath) => !modulePath.startsWith(sourceModuleRoot));
  if (outsideBoundary.length > 0) {
    return {
      modules: [],
      problems: [
        `${sourceLocation(sourceFile, node)} local import leaves MCP boundary: ${specifier}`,
      ],
    };
  }

  return { modules, problems: [] };
}

function stringLiteralText(node: ts.Node | undefined): string | null {
  return node && ts.isStringLiteralLike(node) ? node.text : null;
}

function hasRuntimeImportEdge(node: ts.ImportDeclaration): boolean {
  const importClause = node.importClause;
  if (!importClause) return true;
  if (importClause.isTypeOnly) return false;

  const namedBindings = importClause.namedBindings;
  return (
    Boolean(importClause.name) ||
    !namedBindings ||
    ts.isNamespaceImport(namedBindings) ||
    namedBindings.elements.some((element) => !element.isTypeOnly)
  );
}

function hasRuntimeExportEdge(node: ts.ExportDeclaration): boolean {
  if (node.isTypeOnly) return false;
  const exportClause = node.exportClause;
  return (
    !exportClause ||
    !ts.isNamedExports(exportClause) ||
    exportClause.elements.some((element) => !element.isTypeOnly)
  );
}

function isModuleLoadingCall(node: ts.CallExpression): boolean {
  const firstArgument = node.arguments[0];
  if (!firstArgument) return false;
  return (
    node.expression.kind === ts.SyntaxKind.ImportKeyword ||
    (ts.isIdentifier(node.expression) && node.expression.text === 'require')
  );
}

function moduleSpecifierFromCall(node: ts.CallExpression): string | null {
  return isModuleLoadingCall(node) ? stringLiteralText(node.arguments[0]) : null;
}

function importedLocalModules(
  sourceFile: ts.SourceFile,
  sourcePath: string,
): { modules: string[]; problems: string[] } {
  const modules: string[] = [];
  const problems: string[] = [];

  function visit(node: ts.Node) {
    const isRuntimeImport = ts.isImportDeclaration(node) && hasRuntimeImportEdge(node);
    const isRuntimeExport = ts.isExportDeclaration(node) && hasRuntimeExportEdge(node);
    if (isRuntimeImport || isRuntimeExport) {
      const specifier = stringLiteralText(node.moduleSpecifier);
      if (specifier) {
        const resolved = resolveLocalModule(specifier, sourcePath, sourceFile, node);
        modules.push(...resolved.modules);
        problems.push(...resolved.problems);
      }
    }

    if (ts.isCallExpression(node) && isModuleLoadingCall(node)) {
      const specifier = moduleSpecifierFromCall(node);
      if (specifier) {
        const resolved = resolveLocalModule(specifier, sourcePath, sourceFile, node);
        modules.push(...resolved.modules);
        problems.push(...resolved.problems);
      } else {
        problems.push(`${sourceLocation(sourceFile, node)} nonliteral dynamic module import`);
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return { modules, problems };
}

function collectGuardedSourceModules() {
  const pending = sourceRoots.flatMap(listTypeScriptSources);
  const visited = new Set<string>();
  const problems: string[] = [];

  for (const sourcePath of pending) {
    if (visited.has(sourcePath)) continue;
    visited.add(sourcePath);

    const sourceFile = parseSourceFile(sourcePath);
    const imported = importedLocalModules(sourceFile, sourcePath);
    problems.push(...imported.problems);
    for (const importedModulePath of imported.modules) {
      if (!visited.has(importedModulePath)) pending.push(importedModulePath);
    }
  }

  return {
    modules: Array.from(visited).sort((left, right) => {
      if (left === right) return 0;
      return left < right ? -1 : 1;
    }),
    problems,
  };
}

function findDirectFetchReferences() {
  const guardedSources = collectGuardedSourceModules();
  return guardedSources.modules
    .flatMap((sourcePath) => {
      const sourceFile = parseSourceFile(sourcePath);
      const findings: string[] = [];

      function visit(node: ts.Node) {
        if (ts.isImportDeclaration(node) && !hasRuntimeImportEdge(node)) return;
        if (ts.isExportDeclaration(node) && !hasRuntimeExportEdge(node)) return;
        if ((ts.isImportSpecifier(node) || ts.isExportSpecifier(node)) && node.isTypeOnly) {
          return;
        }

        if (ts.isIdentifier(node) && node.text === 'fetch') {
          findings.push(`${sourceLocation(sourceFile, node)} fetch identifier`);
        }

        if (ts.isPropertyAccessExpression(node) && node.name.text === 'fetch') {
          findings.push(`${sourceLocation(sourceFile, node)} fetch property access`);
        }

        if (
          ts.isElementAccessExpression(node) &&
          stringLiteralText(node.argumentExpression) === 'fetch'
        ) {
          findings.push(`${sourceLocation(sourceFile, node)} computed fetch property access`);
        }

        ts.forEachChild(node, visit);
      }

      visit(sourceFile);
      return findings;
    })
    .concat(guardedSources.problems);
}

afterAll(() => {
  vi.unstubAllGlobals();
});

describe('MCP registered handlers', () => {
  it('keep registered handler sources free of direct fetch paths', () => {
    expect(findDirectFetchReferences()).toEqual([]);
  });

  it('runs every registered handler without direct outbound fetch', async () => {
    // Readers legitimately use the database and cached GitHub client. Mock
    // those boundaries, leaving every registered handler and its helpers real.
    // The fetch guard is installed before registry imports, so module-scope
    // aliases capture the guarded function instead of the real network fetch.
    expect(
      fetchGuard.guardedFetch,
      'MCP modules must not fetch during import-time evaluation',
    ).not.toHaveBeenCalled();

    const tools = sortedRegisteredTools();
    const registeredToolNames = tools.map((tool) => tool.name);
    const sampleNames = Object.keys(toolSamples).sort();

    const missingSamples = registeredToolNames.filter((name) => !(name in toolSamples));
    expect(missingSamples, 'Add sample input before registering a new MCP tool.').toEqual([]);

    const staleSamples = sampleNames.filter((name) => !registeredToolNames.includes(name));
    expect(staleSamples, 'Remove sample input for unregistered MCP tools.').toEqual([]);

    expect(registeredToolNames).toEqual(sampleNames);

    for (const tool of tools) {
      const sample = toolSamples[tool.name as RegisteredToolName];
      const input = tool.inputSchema.parse(sample);
      const result = await tool.handler(input as never, context());

      expect(result.isError, `${tool.name} should complete its success path`).toBeFalsy();
      expect(
        fetchGuard.guardedFetch,
        `${tool.name} must not fetch directly`,
      ).not.toHaveBeenCalled();
    }

    for (const resource of tribunalMcpRegistry.resources) {
      const result = await resource.handler(new URL(resource.uri), context());
      expect(
        result.contents.length,
        `${resource.name} should complete its success path`,
      ).toBeGreaterThan(0);
      expect(
        fetchGuard.guardedFetch,
        `${resource.name} must not fetch directly`,
      ).not.toHaveBeenCalled();
    }

    expect(
      tribunalMcpRegistry.prompts,
      'Add prompt argument samples and invoke their handlers when registering prompts.',
    ).toEqual([]);
    expect(fetchGuard.guardedFetch).not.toHaveBeenCalled();
  });
});
