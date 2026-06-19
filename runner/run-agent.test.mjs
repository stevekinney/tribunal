import { describe, expect, it } from 'vitest';
import { pathToFileURL } from 'node:url';
import {
  createTribunalMcpServer,
  isAgentSlug,
  isMainModule,
  redactRuntimeValueForEvent,
  runClaudeReview,
} from './run-agent.mjs';

const diffContext = {
  headSha: 'head',
  baseSha: 'abc1234',
  changedFiles: [
    {
      path: 'src/auth.ts',
      status: 'modified',
      patch: '@@ -10,3 +10,3 @@\n old\n+new',
      commentableLines: [{ side: 'RIGHT', line: 12 }],
    },
  ],
  pr: {
    number: 13,
    title: 'Harden review runner',
    body: 'Please review.',
    labels: ['security'],
    author: 'octocat',
  },
};

const validFinding = {
  path: 'src/auth.ts',
  startLine: 12,
  endLine: null,
  side: 'RIGHT',
  severity: 'warning',
  title: '@team check auth',
  body: '@everyone\n/approve this',
};

describe('runner agent wiring', () => {
  it('exposes record_finding as stateful MCP tool metadata', () => {
    const reviewTools = createReviewTools();
    const captured = createFakeSdk();

    createTribunalMcpServer(reviewTools, captured.sdk);

    const toolMetadata = Object.fromEntries(
      captured.server.tools.map((tool) => [tool.name, tool.options.annotations.readOnlyHint]),
    );
    expect(toolMetadata).toEqual({
      get_changed_files: true,
      read_base_file: true,
      get_pr_context: true,
      get_review_guidelines: true,
      record_finding: false,
    });
  });

  it('collects MCP findings, sanitizes structured output, and redacts tool events', async () => {
    const captured = createFakeSdk();
    const events = [];
    const readGitObjectCalls = [];
    let queryOptions;

    const result = await runClaudeReview({
      agentSlug: 'security-review',
      repositoryPath: '/workspace/repository',
      model: 'sonnet',
      effort: null,
      agentDescription: 'Find security defects.',
      agentBody: 'Only report confirmed findings.',
      guidelines: 'Prefer concrete evidence.',
      diffContext,
      startedAt: performance.now(),
      emitEvent: (kind, detail, tool) => events.push({ kind, detail, tool }),
      createMcpServer: (reviewTools) => createTribunalMcpServer(reviewTools, captured.sdk),
      readGitObject: (repositoryPath, revision, filePath) => {
        readGitObjectCalls.push({ repositoryPath, revision, filePath });
        return `base contents for ${filePath}`;
      },
      queryClient: async function* ({ options }) {
        queryOptions = options;
        await options.canUseTool(
          'Read',
          { file_path: 'src/auth.ts', token: 'ghs_abcdefghijklmnopqrstuvwxyz' },
          { toolUseID: 'tool_1' },
        );

        const readBaseFile = captured.server.tools.find((tool) => tool.name === 'read_base_file');
        expect(parseToolResult(await readBaseFile.execute({ path: 'src/auth.ts' }))).toEqual({
          path: 'src/auth.ts',
          contents: 'base contents for src/auth.ts',
        });
        expect(parseToolResult(await readBaseFile.execute({ path: 'src/missing.ts' }))).toEqual({
          path: 'src/missing.ts',
          contents: null,
        });

        const recordFinding = captured.server.tools.find((tool) => tool.name === 'record_finding');
        await recordFinding.execute({ finding: validFinding });
        await recordFinding.execute({ finding: { ...validFinding, path: '../secret.env' } });

        yield { type: 'system', subtype: 'init' };
        yield { type: 'assistant', uuid: 'message_1' };
        yield {
          type: 'result',
          usage: {
            input_tokens: 10,
            output_tokens: 5,
            cache_read_input_tokens: 3,
            cache_creation_input_tokens: 2,
          },
          total_cost_usd: 0.01,
          structured_output: {
            findings: [
              validFinding,
              { ...validFinding, startLine: 99, title: 'Off diff' },
              { ...validFinding, path: '../secret.env', title: 'Escaped path' },
            ],
          },
        };
      },
    });

    expect(queryOptions.mcpServers.tribunal).toBe(captured.server);
    expect(queryOptions.allowedTools).toContain('mcp__tribunal__record_finding');
    expect(readGitObjectCalls).toEqual([
      {
        repositoryPath: '/workspace/repository',
        revision: 'abc1234',
        filePath: 'src/auth.ts',
      },
    ]);
    expect(events).toContainEqual({
      kind: 'tool_pre',
      tool: 'Read',
      detail: {
        toolName: 'Read',
        input: { file_path: 'src/auth.ts', token: '[REDACTED]' },
        allowed: true,
        denied: false,
        reason: undefined,
      },
    });
    expect(result.findings).toEqual([
      {
        ...validFinding,
        title: 'team check auth',
        body: 'everyone\napprove this',
      },
      {
        ...validFinding,
        startLine: null,
        endLine: null,
        title: 'Off diff',
        body: 'everyone\napprove this',
      },
    ]);
    expect(result.usage).toEqual({
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 3,
      cacheCreationTokens: 2,
    });
  });

  it('redacts event payload strings and arrays before logging', () => {
    expect(redactRuntimeValueForEvent('token: sk-ant-secret')).toBe('token: [REDACTED]');
    expect(
      redactRuntimeValueForEvent([
        'github_pat_abcdefghijklmnopqrstuvwxyz',
        { token: 'ghs_abcdefghijklmnopqrstuvwxyz' },
      ]),
    ).toEqual(['[REDACTED]', { token: '[REDACTED]' }]);
  });

  it('detects relative script paths as the main module', () => {
    const cwd = '/workspace/repository';
    const moduleUrl = pathToFileURL(`${cwd}/runner/run-agent.mjs`).href;

    expect(isMainModule(moduleUrl, ['bun', 'runner/run-agent.mjs'], cwd)).toBe(true);
    expect(isMainModule(moduleUrl, ['bun', 'runner/other-agent.mjs'], cwd)).toBe(false);
  });

  it('accepts digit-leading agent slugs allowed by the shared agent schema', () => {
    expect(isAgentSlug('1-security-review')).toBe(true);
    expect(isAgentSlug('security-review')).toBe(true);
    expect(isAgentSlug('-security-review')).toBe(false);
    expect(isAgentSlug('security-review-')).toBe(false);
  });
});

function createReviewTools() {
  return {
    get_changed_files: {
      description: 'Return changed files.',
      readOnlyHint: true,
      execute: () => ({ changedFiles: [], changedSinceLast: [] }),
    },
    read_base_file: {
      description: 'Read base file.',
      readOnlyHint: true,
      execute: () => ({ path: 'src/auth.ts', contents: null }),
    },
    get_pr_context: {
      description: 'Return pull request context.',
      readOnlyHint: true,
      execute: () => ({ pullRequest: diffContext.pr, headSha: 'head', baseSha: 'base' }),
    },
    get_review_guidelines: {
      description: 'Return guidelines.',
      readOnlyHint: true,
      execute: () => ({ guidelines: 'Prefer concrete evidence.' }),
    },
    record_finding: {
      description: 'Record finding.',
      readOnlyHint: false,
      collectedFindings: [],
      execute: () => ({ ok: true }),
    },
  };
}

function createFakeSdk() {
  const captured = {};
  return {
    get server() {
      return captured.server;
    },
    sdk: {
      createServer: (server) => {
        captured.server = server;
        return server;
      },
      defineTool: (name, description, schema, execute, options) => ({
        name,
        description,
        schema,
        execute,
        options,
      }),
    },
  };
}

function parseToolResult(result) {
  return JSON.parse(result.content[0].text);
}
