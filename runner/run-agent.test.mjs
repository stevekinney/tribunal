import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { pathToFileURL } from 'node:url';
import {
  createTribunalMcpServer,
  isAgentSlug,
  isMainModule,
  main,
  parseAgentRole,
  parseAvailableAgentSlugs,
  parseFindingToVerify,
  parseMaxBudgetUsd,
  redactRuntimeValueForEvent,
  runClaudeReview,
  writeResult,
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
  suggestion: 'const token = "sk-ant-secret";',
};

const baseEnvironment = {
  TRIBUNAL_RUN_TOKEN: 'run-token',
  TRIBUNAL_AGENT_RUN_ID: 'agent-run-1',
  TRIBUNAL_AGENT_MODEL: 'sonnet',
  TRIBUNAL_AGENT_EFFORT: 'xhigh',
  TRIBUNAL_DIFF_CONTEXT: JSON.stringify(diffContext),
};

describe('runner agent wiring', () => {
  it('exposes record_finding as stateful MCP tool metadata', () => {
    const reviewTools = createReviewTools();
    const captured = createFakeSdk();

    createTribunalMcpServer(reviewTools, captured.sdk);

    expect(captured.server.instructions).toContain('use record_finding to report findings');
    expect(captured.server.instructions).not.toContain('Read-only Tribunal review tools');
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

  it('sanitizes structured output and redacts tool events', async () => {
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
        await options.canUseTool(
          'mcp__tribunal__record_finding',
          {
            finding: {
              ...validFinding,
              title: 'Raw repository title',
              body: 'Raw repository body\nconst secret = "value";',
              suggestion: 'const leakedRepositoryContent = true;',
            },
          },
          { toolUseID: 'tool_2' },
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
    expect(events).toContainEqual({
      kind: 'tool_pre',
      tool: 'mcp__tribunal__record_finding',
      detail: {
        toolName: 'mcp__tribunal__record_finding',
        input: {
          finding: {
            path: 'src/auth.ts',
            startLine: 12,
            endLine: null,
            side: 'RIGHT',
            severity: 'warning',
            title: '[redacted 20 chars]',
            body: '[redacted 43 chars]',
            suggestion: '[redacted 37 chars]',
          },
        },
        allowed: true,
        denied: false,
        reason: undefined,
      },
    });
    expect(JSON.stringify(events)).not.toContain('Raw repository body');
    expect(JSON.stringify(events)).not.toContain('leakedRepositoryContent');
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

  it('returns collected MCP findings when the SDK stream fails after record_finding succeeds', async () => {
    const captured = createFakeSdk();

    await expect(
      runClaudeReview({
        agentSlug: 'security-review',
        repositoryPath: '/workspace/repository',
        model: 'sonnet',
        effort: null,
        agentDescription: 'Find security defects.',
        agentBody: 'Only report confirmed findings.',
        guidelines: 'Prefer concrete evidence.',
        diffContext,
        createMcpServer: (reviewTools) => createTribunalMcpServer(reviewTools, captured.sdk),
        queryClient: async function* () {
          const recordFinding = captured.server.tools.find(
            (tool) => tool.name === 'record_finding',
          );
          await recordFinding.execute({ finding: validFinding });
          throw new Error('SDK stream failed');
        },
      }),
    ).rejects.toMatchObject({
      collectedFindings: [
        {
          ...validFinding,
          title: 'team check auth',
          body: 'everyone\napprove this',
        },
      ],
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

  it('sets permissionMode to dontAsk with explicit allow/deny tool lists, top-level and per-agent', async () => {
    const captured = createFakeSdk();
    let queryOptions;

    await runClaudeReview({
      agentSlug: 'security-review',
      repositoryPath: '/workspace/repository',
      model: 'sonnet',
      effort: null,
      agentDescription: 'Find security defects.',
      agentBody: 'Only report confirmed findings.',
      guidelines: 'Prefer concrete evidence.',
      diffContext,
      createMcpServer: (reviewTools) => createTribunalMcpServer(reviewTools, captured.sdk),
      queryClient: async function* ({ options }) {
        queryOptions = options;
        yield { type: 'result', structured_output: { findings: [] }, usage: {}, total_cost_usd: 0 };
      },
    });

    expect(queryOptions.permissionMode).toBe('dontAsk');
    expect(queryOptions.agents['security-review'].permissionMode).toBe('dontAsk');
    expect(queryOptions.disallowedTools).toEqual(
      expect.arrayContaining([
        'Bash',
        'Write',
        'Edit',
        'MultiEdit',
        'NotebookEdit',
        'WebFetch',
        'WebSearch',
      ]),
    );
    expect(queryOptions.strictMcpConfig).toBe(true);
  });

  it('plumbs maxBudgetUsd to the query options when provided', async () => {
    const captured = createFakeSdk();
    let queryOptions;

    await runClaudeReview({
      agentSlug: 'security-review',
      repositoryPath: '/workspace/repository',
      model: 'sonnet',
      effort: null,
      maxBudgetUsd: 2.5,
      agentDescription: 'Find security defects.',
      agentBody: 'Only report confirmed findings.',
      guidelines: 'Prefer concrete evidence.',
      diffContext,
      createMcpServer: (reviewTools) => createTribunalMcpServer(reviewTools, captured.sdk),
      queryClient: async function* ({ options }) {
        queryOptions = options;
        yield { type: 'result', structured_output: { findings: [] }, usage: {}, total_cost_usd: 0 };
      },
    });

    expect(queryOptions.maxBudgetUsd).toBe(2.5);
  });

  it('omits maxBudgetUsd from query options when not provided', async () => {
    const captured = createFakeSdk();
    let queryOptions;

    await runClaudeReview({
      agentSlug: 'security-review',
      repositoryPath: '/workspace/repository',
      model: 'sonnet',
      effort: null,
      agentDescription: 'Find security defects.',
      agentBody: 'Only report confirmed findings.',
      guidelines: 'Prefer concrete evidence.',
      diffContext,
      createMcpServer: (reviewTools) => createTribunalMcpServer(reviewTools, captured.sdk),
      queryClient: async function* ({ options }) {
        queryOptions = options;
        yield { type: 'result', structured_output: { findings: [] }, usage: {}, total_cost_usd: 0 };
      },
    });

    expect(queryOptions.maxBudgetUsd).toBeUndefined();
  });

  it('parses maxBudgetUsd from environment strings, rejecting non-positive values', () => {
    expect(parseMaxBudgetUsd('2.5')).toBe(2.5);
    expect(parseMaxBudgetUsd('0')).toBeUndefined();
    expect(parseMaxBudgetUsd('-1')).toBeUndefined();
    expect(parseMaxBudgetUsd('not-a-number')).toBeUndefined();
    expect(parseMaxBudgetUsd(undefined)).toBeUndefined();
    expect(parseMaxBudgetUsd('')).toBeUndefined();
  });

  it('disables filesystem settings sources and auto-memory for multi-tenant isolation', async () => {
    let queryOptions;

    await main({
      argv: ['bun', 'runner/run-agent.mjs', 'security-review'],
      environment: baseEnvironment,
      stdout: createWritable(),
      stderr: createWritable(),
      exit: vi.fn(),
      queryClient: (arguments_) => {
        queryOptions = arguments_.options;
        return streamMessages([
          { type: 'result', structured_output: { findings: [] }, usage: {}, total_cost_usd: 0 },
        ]);
      },
    });

    expect(queryOptions.settingSources).toEqual([]);
    expect(queryOptions.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY).toBe('1');
  });

  it('runs the triage role with its own prompt and structured output schema', async () => {
    const captured = createFakeSdk();
    let queryOptions;

    const result = await runClaudeReview({
      agentSlug: 'triage',
      repositoryPath: '/workspace/repository',
      model: 'haiku',
      effort: 'low',
      role: 'triage',
      availableAgentSlugs: ['correctness-review', 'security-review'],
      diffContext,
      guidelines: 'Prefer concrete evidence.',
      agentDescription: 'Triage',
      agentBody: 'Classify the pull request.',
      createMcpServer: (reviewTools) => createTribunalMcpServer(reviewTools, captured.sdk),
      queryClient: async function* ({ prompt, options }) {
        queryOptions = options;
        expect(prompt).toContain('correctness-review, security-review');
        yield {
          type: 'result',
          usage: {},
          total_cost_usd: 0.001,
          structured_output: { skip: false, reason: 'Touches auth logic.', riskFlags: ['auth'] },
        };
      },
    });

    expect(queryOptions.outputFormat.schema.required).toEqual(['skip', 'reason', 'riskFlags']);
    expect(result).toMatchObject({
      findings: [],
      triage: { skip: false, reason: 'Touches auth logic.', riskFlags: ['auth'] },
    });
  });

  it('runs the verifier role against a specific candidate finding', async () => {
    const captured = createFakeSdk();
    let queryOptions;

    const result = await runClaudeReview({
      agentSlug: 'verifier',
      repositoryPath: '/workspace/repository',
      model: 'haiku',
      effort: 'low',
      role: 'verifier',
      findingToVerify: validFinding,
      diffContext,
      guidelines: 'Prefer concrete evidence.',
      agentDescription: 'Verifier',
      agentBody: 'Try to refute this finding.',
      createMcpServer: (reviewTools) => createTribunalMcpServer(reviewTools, captured.sdk),
      queryClient: async function* ({ prompt, options }) {
        queryOptions = options;
        expect(prompt).toContain(`Path: ${validFinding.path}`);
        yield {
          type: 'result',
          usage: {},
          total_cost_usd: 0.0005,
          structured_output: { verified: true, note: 'Confirmed at the cited line.' },
        };
      },
    });

    expect(queryOptions.outputFormat.schema.required).toEqual(['verified', 'note']);
    expect(result).toMatchObject({
      findings: [],
      verification: { verified: true, note: 'Confirmed at the cited line.' },
    });
  });

  it('parses role, available agent slugs, and finding-to-verify environment values', () => {
    expect(parseAgentRole('triage')).toBe('triage');
    expect(parseAgentRole('verifier')).toBe('verifier');
    expect(parseAgentRole('specialist')).toBe('specialist');
    expect(parseAgentRole('bogus')).toBe('specialist');
    expect(parseAgentRole(undefined)).toBe('specialist');

    expect(parseAvailableAgentSlugs('["a","b"]')).toEqual(['a', 'b']);
    expect(parseAvailableAgentSlugs(undefined)).toEqual([]);
    expect(parseAvailableAgentSlugs('not-json')).toEqual([]);

    expect(parseFindingToVerify(JSON.stringify(validFinding))).toEqual(validFinding);
    expect(parseFindingToVerify(undefined)).toBeUndefined();
    expect(parseFindingToVerify('not-json')).toBeUndefined();
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

  it('writes partial cost when SIGTERM arrives before completion', async () => {
    const signalSource = new EventEmitter();
    const stdout = createWritable();
    const exit = vi.fn();
    let releaseQuery;

    const run = main({
      argv: ['bun', 'runner/run-agent.mjs', 'security-review'],
      environment: baseEnvironment,
      stdout,
      stderr: createWritable(),
      exit,
      signalSource,
      performanceNow: vi.fn().mockReturnValueOnce(100).mockReturnValue(125),
      queryClient: async function* () {
        yield {
          type: 'result',
          structured_output: { findings: [] },
          modelUsage: { model_id: 'claude-sonnet-4-6-20251101', effort: 'high' },
          usage: { input_tokens: 5 },
          total_cost_usd: 0.09,
        };
        signalSource.emit('SIGTERM');
        yield await new Promise((resolve) => {
          releaseQuery = () => resolve({ type: 'system', subtype: 'done' });
        });
      },
    });

    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(143));
    releaseQuery();
    await run;

    expect(stdout.records().find((record) => record.type === 'result')).toMatchObject({
      type: 'result',
      result: {
        modelUsed: 'sonnet',
        effortUsed: 'xhigh',
        costEstimateUsd: 0.09,
        error: 'Agent review stopped before completion.',
      },
    });
  });

  it('removes the SIGTERM listener after normal completion', async () => {
    const signalSource = new EventEmitter();

    await main({
      argv: ['bun', 'runner/run-agent.mjs', 'security-review'],
      environment: baseEnvironment,
      stdout: createWritable(),
      stderr: createWritable(),
      exit: vi.fn(),
      signalSource,
      queryClient: () =>
        streamMessages([
          {
            type: 'result',
            structured_output: { findings: [] },
            usage: {},
            total_cost_usd: 0,
          },
        ]),
    });

    expect(signalSource.listenerCount('SIGTERM')).toBe(0);
  });

  it('keeps a successful result retryable when the first write fails', async () => {
    const stdout = createWritableThatFailsFirstResult();
    const result = {
      agentSlug: 'security-review',
      findings: [],
      modelUsed: 'sonnet',
      effortUsed: null,
      usage: {},
      costEstimateUsd: 0,
      durationMs: 0,
    };

    await expect(writeResult(stdout, { written: false }, result)).rejects.toThrow('write failed');
    await writeResult(stdout, { written: false }, result);

    expect(stdout.records()).toEqual([{ type: 'result', result }]);
  });
});

function createWritable() {
  let value = '';
  return {
    write(chunk, callback) {
      value += chunk;
      callback?.();
    },
    once: vi.fn(),
    off: vi.fn(),
    records() {
      return value
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    },
  };
}

function createWritableThatFailsFirstResult() {
  const emitter = new EventEmitter();
  let resultWrites = 0;
  let value = '';
  return Object.assign(emitter, {
    write(chunk, callback) {
      if (String(chunk).includes('"type":"result"')) {
        resultWrites += 1;
        if (resultWrites === 1) {
          queueMicrotask(() => this.emit('error', new Error('write failed')));
          return;
        }
      }
      value += chunk;
      callback?.();
    },
    records() {
      return value
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    },
  });
}

async function* streamMessages(messages) {
  for (const message of messages) yield message;
}

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
