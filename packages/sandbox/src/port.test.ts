import { describe, expect, it } from 'vitest';
import type { AgentEvent, AgentResult, DiffContext } from '@tribunal/review-core/types';
import { createSandboxPort, type SandboxAdapter, type SandboxCreateInput } from './port';

const result: AgentResult = {
  agentSlug: 'security-reviewer',
  findings: [],
  modelUsed: 'claude-sonnet-4-6',
  effortUsed: 'high',
  usage: {
    inputTokens: 1,
    outputTokens: 2,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
  },
  costEstimateUsd: 0.01,
  durationMs: 100,
};

const diffContext: DiffContext = {
  headSha: 'head-sha',
  baseSha: 'base-sha',
  changedFiles: [
    {
      path: 'src/auth.ts',
      status: 'modified',
      patch: '@@ -10,2 +10,2 @@\n-old\n+new',
      commentableLines: [{ side: 'RIGHT', line: 11 }],
    },
  ],
  pr: {
    number: 42,
    title: 'Review engine foundation',
    body: 'Pull request body',
    labels: ['review-engine'],
    author: 'steve',
  },
};

function createFakeAdapter() {
  const calls: Array<{ method: string; input: unknown }> = [];
  const adapter: SandboxAdapter = {
    async create(input: SandboxCreateInput) {
      calls.push({ method: 'create', input });
      return { sandboxId: 'sandbox_1' };
    },
    async runCommand(sandboxId, command, arguments_, environment) {
      calls.push({ method: 'runCommand', input: { sandboxId, command, arguments_, environment } });
      return { exitCode: 0, stdout: JSON.stringify({ type: 'result', result }), stderr: '' };
    },
    async runTrackedCommand(
      sandboxId,
      command,
      arguments_,
      environment,
      onProcessStart,
      _onStdoutLine,
      signal,
    ) {
      calls.push({
        method: 'runTrackedCommand',
        input: { sandboxId, command, arguments_, environment, signal },
      });
      await onProcessStart('123');
      return { exitCode: 0, stdout: JSON.stringify({ type: 'result', result }), stderr: '' };
    },
    async killProcess(sandboxId, processId) {
      calls.push({ method: 'killProcess', input: { sandboxId, processId } });
    },
    async suspend(sandboxId) {
      calls.push({ method: 'suspend', input: { sandboxId } });
    },
    async terminate(sandboxId) {
      calls.push({ method: 'terminate', input: { sandboxId } });
    },
  };

  return { adapter, calls };
}

describe('sandbox port', () => {
  it('creates sandboxes with proxy-only egress configuration', async () => {
    const { adapter, calls } = createFakeAdapter();
    const port = createSandboxPort(adapter, {
      image: 'tribunal-reviewer:latest',
      proxyUrl: 'https://proxy.tribunal.local',
      proxyCidr: '10.0.0.8/32',
    });

    await port.ensure('tribunal-pr-42-7', {
      image: 'ignored',
      proxyUrl: 'ignored',
      idleSuspendSeconds: 123,
    });

    expect(calls[0]).toMatchObject({
      method: 'create',
      input: {
        name: 'tribunal-pr-42-7',
        image: 'tribunal-reviewer:latest',
        timeoutSecs: 123,
        allowInternetAccess: false,
        allowOut: ['10.0.0.8/32'],
        secretNames: [],
      },
    });
  });

  it('rejects invalid idle suspend timeouts before creating a sandbox', async () => {
    const { adapter, calls } = createFakeAdapter();
    const port = createSandboxPort(adapter, {
      image: 'tribunal-reviewer:latest',
      proxyUrl: 'https://proxy.tribunal.local',
      proxyCidr: '10.0.0.8/32',
    });

    await expect(
      port.ensure('tribunal-pr-42-7', {
        image: 'ignored',
        proxyUrl: 'ignored',
        idleSuspendSeconds: 0,
      }),
    ).rejects.toThrow('idleSuspendSeconds must be a positive integer.');
    await expect(
      port.ensure('tribunal-pr-42-7', {
        image: 'ignored',
        proxyUrl: 'ignored',
        idleSuspendSeconds: 1.5,
      }),
    ).rejects.toThrow('idleSuspendSeconds must be a positive integer.');

    expect(calls).toEqual([]);
  });

  it('uses proxy clone URLs and run-token authorization for updates', async () => {
    const { adapter, calls } = createFakeAdapter();
    const port = createSandboxPort(adapter, {
      image: 'tribunal-reviewer:latest',
      proxyUrl: 'https://proxy.tribunal.local',
      proxyCidr: '10.0.0.8/32',
    });

    await port.update(
      'sandbox_1',
      { owner: 'stevekinney', name: 'tribunal' },
      'a'.repeat(40),
      'capability-token',
    );

    expect(calls[0]).toMatchObject({ method: 'runCommand' });
    expect(calls[0]).toMatchObject({
      input: {
        command: 'bash',
        environment: {
          TRIBUNAL_REPOSITORY_URL:
            'https://proxy.tribunal.local/github/github.com/stevekinney/tribunal.git',
          TRIBUNAL_HEAD_SHA: 'a'.repeat(40),
          TRIBUNAL_RUN_TOKEN: 'capability-token',
        },
      },
    });
    const firstCall = calls[0];
    expect(firstCall).toBeDefined();
    const commandArguments = (firstCall!.input as { arguments_: string[] }).arguments_;
    expect(commandArguments.join(' ')).toContain('git -C /workspace/repository');
    expect(commandArguments.join(' ')).toContain(
      'http.extraHeader=Authorization: Bearer $TRIBUNAL_RUN_TOKEN',
    );
    expect(commandArguments.join(' ')).not.toContain('http.proxy');
    expect(commandArguments.join(' ')).not.toContain('clone-or-fetch');
    expect(commandArguments.join(' ')).not.toContain('capability-token');
  });

  it('normalizes proxy clone URLs before validating update input', async () => {
    const { adapter, calls } = createFakeAdapter();
    const port = createSandboxPort(adapter, {
      image: 'tribunal-reviewer:latest',
      proxyUrl: 'https://proxy.tribunal.local/base/?ignored=true#fragment',
      proxyCidr: '10.0.0.8/32',
    });

    await port.update(
      'sandbox_1',
      { owner: 'stevekinney', name: 'tribunal' },
      'a'.repeat(40),
      'capability-token',
    );

    expect(calls[0]).toMatchObject({
      input: {
        environment: {
          TRIBUNAL_REPOSITORY_URL:
            'https://proxy.tribunal.local/base/github/github.com/stevekinney/tribunal.git',
        },
      },
    });
  });

  it('rejects invalid repository URLs before calling the adapter', async () => {
    const { adapter, calls } = createFakeAdapter();
    const port = createSandboxPort(adapter, {
      image: 'tribunal-reviewer:latest',
      proxyUrl: 'https://proxy.tribunal.local',
      proxyCidr: '10.0.0.8/32',
    });

    await expect(
      port.update('sandbox_1', { owner: '..', name: 'tribunal' }, 'a'.repeat(40), 'token'),
    ).rejects.toThrow('invalid clone input');
    expect(calls).toEqual([]);
  });

  it('rejects failed repository updates before agents run', async () => {
    const { adapter } = createFakeAdapter();
    adapter.runCommand = async () => ({
      exitCode: 128,
      stdout: '',
      stderr: 'fatal: could not fetch',
    });
    const port = createSandboxPort(adapter, {
      image: 'tribunal-reviewer:latest',
      proxyUrl: 'https://proxy.tribunal.local',
      proxyCidr: '10.0.0.8/32',
    });

    await expect(
      port.update(
        'sandbox_1',
        { owner: 'stevekinney', name: 'tribunal' },
        'a'.repeat(40),
        'capability-token',
      ),
    ).rejects.toThrow('Sandbox repository update failed with exit code 128');
  });

  it('validates runAgent output and delegates suspend and terminate calls', async () => {
    const { adapter, calls } = createFakeAdapter();
    const port = createSandboxPort(adapter, {
      image: 'tribunal-reviewer:latest',
      proxyUrl: 'https://proxy.tribunal.local',
      proxyCidr: '10.0.0.8/32',
    });

    const abortController = new AbortController();
    await expect(
      port.runAgent(
        'sandbox_1',
        {
          id: 'agent_1',
          agentRunId: 'agent_run_1',
          userId: 1,
          slug: 'security-reviewer',
          description: 'Find security issues',
          body: 'Review.',
          model: 'sonnet',
          effort: 'high',
          enabled: true,
        },
        diffContext,
        'token',
        () => {},
        abortController.signal,
      ),
    ).resolves.toMatchObject({ agentSlug: 'security-reviewer' });
    await port.suspend('sandbox_1');
    await port.terminate('sandbox_1');

    expect(calls.map((call) => call.method)).toEqual(['runTrackedCommand', 'suspend', 'terminate']);
    expect(calls[0]).toMatchObject({
      input: {
        environment: {
          TRIBUNAL_RUN_TOKEN: 'token',
          TRIBUNAL_AGENT_RUN_ID: 'agent_run_1',
          TRIBUNAL_PROXY_URL: 'https://proxy.tribunal.local',
          ANTHROPIC_BASE_URL: 'https://proxy.tribunal.local/anthropic/api.anthropic.com',
          TRIBUNAL_AGENT_MODEL: 'sonnet',
          TRIBUNAL_AGENT_EFFORT: 'high',
          TRIBUNAL_DIFF_CONTEXT: JSON.stringify(diffContext),
          TRIBUNAL_CHANGED_FILES: JSON.stringify(['src/auth.ts']),
        },
        signal: abortController.signal,
      },
    });
  });

  it('parses JSONL agent runner output and forwards event records', async () => {
    const { adapter } = createFakeAdapter();
    const event = {
      agentRunId: 'agent_run_1',
      seq: 1,
      kind: 'tool_pre',
      tool: 'Read',
      detail: { path: 'src/auth.ts' },
      at: '2026-06-18T10:00:00.000Z',
    } satisfies AgentEvent;
    adapter.runTrackedCommand = async () => ({
      exitCode: 0,
      stdout: [JSON.stringify(event), JSON.stringify(result)].join('\n'),
      stderr: '',
    });
    const port = createSandboxPort(adapter, {
      image: 'tribunal-reviewer:latest',
      proxyUrl: 'https://proxy.tribunal.local',
      proxyCidr: '10.0.0.8/32',
    });
    const events: AgentEvent[] = [];

    await expect(
      port.runAgent(
        'sandbox_1',
        {
          id: 'agent_1',
          agentRunId: 'agent_run_1',
          userId: 1,
          slug: 'security-reviewer',
          description: 'Find security issues',
          body: 'Review.',
          model: 'sonnet',
          enabled: true,
        },
        diffContext,
        'token',
        (agentEvent) => events.push(agentEvent),
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({ agentSlug: 'security-reviewer' });
    expect(events).toEqual([event]);
  });

  it('parses wrapped JSONL event and result records from the runner', async () => {
    const { adapter } = createFakeAdapter();
    const event = {
      agentRunId: 'agent_run_1',
      seq: 1,
      kind: 'tool_pre',
      tool: 'Read',
      detail: { path: 'src/auth.ts' },
      at: '2026-06-18T10:00:00.000Z',
    } satisfies AgentEvent;
    adapter.runTrackedCommand = async () => ({
      exitCode: 0,
      stdout: [
        JSON.stringify({ type: 'event', event }),
        JSON.stringify({ type: 'result', result }),
      ].join('\n'),
      stderr: '',
    });
    const port = createSandboxPort(adapter, {
      image: 'tribunal-reviewer:latest',
      proxyUrl: 'https://proxy.tribunal.local',
      proxyCidr: '10.0.0.8/32',
    });
    const events: AgentEvent[] = [];

    await expect(
      port.runAgent(
        'sandbox_1',
        {
          id: 'agent_1',
          agentRunId: 'agent_run_1',
          userId: 1,
          slug: 'security-reviewer',
          description: 'Find security issues',
          body: 'Review.',
          model: 'sonnet',
          enabled: true,
        },
        diffContext,
        'token',
        (agentEvent) => events.push(agentEvent),
        new AbortController().signal,
      ),
    ).resolves.toEqual(result);
    expect(events).toEqual([event]);
  });

  it('streams live event lines without replaying events from final stdout', async () => {
    const { adapter, calls } = createFakeAdapter();
    const event = {
      agentRunId: 'agent_1',
      seq: 1,
      kind: 'tool_post',
      tool: 'Read',
      detail: { path: 'src/auth.ts' },
      at: '2026-06-18T10:00:00.000Z',
    } satisfies AgentEvent;
    adapter.runTrackedCommand = async (
      sandboxId,
      command,
      arguments_,
      environment,
      _onProcessStart,
      onStdoutLine,
    ) => {
      calls.push({
        method: 'runTrackedCommand',
        input: { sandboxId, command, arguments_, environment },
      });
      onStdoutLine?.('');
      onStdoutLine?.('not json');
      onStdoutLine?.(JSON.stringify({ type: 'log', message: 'ignored' }));
      onStdoutLine?.(JSON.stringify({ type: 'event', event }));
      return {
        exitCode: 0,
        stdout: [JSON.stringify({ type: 'event', event }), JSON.stringify(result)].join('\n'),
        stderr: '',
      };
    };
    const port = createSandboxPort(adapter, {
      image: 'tribunal-reviewer:latest',
      proxyUrl: 'https://proxy.tribunal.local',
      proxyCidr: '10.0.0.8/32',
    });
    const events: AgentEvent[] = [];

    await expect(
      port.runAgent(
        'sandbox_1',
        {
          id: 'agent_1',
          userId: 1,
          slug: 'security-reviewer',
          description: 'Find security issues',
          body: 'Review.',
          model: 'sonnet',
          enabled: true,
        },
        diffContext,
        'token',
        (agentEvent) => events.push(agentEvent),
        new AbortController().signal,
      ),
    ).resolves.toEqual(result);

    expect(events).toEqual([event]);
    expect(calls[0]).toMatchObject({
      input: {
        environment: {
          TRIBUNAL_AGENT_RUN_ID: 'agent_1',
          TRIBUNAL_DIFF_CONTEXT: JSON.stringify(diffContext),
          TRIBUNAL_CHANGED_FILES: JSON.stringify(['src/auth.ts']),
        },
      },
    });
  });

  it('returns a typed failed result when successful runner commands never emit a final result', async () => {
    const { adapter } = createFakeAdapter();
    const event = {
      agentRunId: 'agent_run_1',
      seq: 1,
      kind: 'tool_pre',
      at: '2026-06-18T10:00:00.000Z',
    } satisfies AgentEvent;
    adapter.runTrackedCommand = async () => ({
      exitCode: 0,
      stdout: JSON.stringify({ type: 'event', event }),
      stderr: '',
    });
    const port = createSandboxPort(adapter, {
      image: 'tribunal-reviewer:latest',
      proxyUrl: 'https://proxy.tribunal.local',
      proxyCidr: '10.0.0.8/32',
    });

    await expect(
      port.runAgent(
        'sandbox_1',
        {
          id: 'agent_1',
          agentRunId: 'agent_run_1',
          userId: 1,
          slug: 'security-reviewer',
          description: 'Find security issues',
          body: 'Review.',
          model: 'sonnet',
          enabled: true,
        },
        diffContext,
        'token',
        () => {},
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({
      agentSlug: 'security-reviewer',
      findings: [],
      costEstimateUsd: 0,
      error: 'Agent runner did not produce a result record.',
    });
  });

  it('returns a typed failed result for empty runner output', async () => {
    const { adapter } = createFakeAdapter();
    adapter.runTrackedCommand = async () => ({
      exitCode: 0,
      stdout: '',
      stderr: '',
    });
    const port = createSandboxPort(adapter, {
      image: 'tribunal-reviewer:latest',
      proxyUrl: 'https://proxy.tribunal.local',
      proxyCidr: '10.0.0.8/32',
    });

    await expect(
      port.runAgent(
        'sandbox_1',
        {
          id: 'agent_1',
          agentRunId: 'agent_run_1',
          userId: 1,
          slug: 'security-reviewer',
          description: 'Find security issues',
          body: 'Review.',
          model: 'sonnet',
          enabled: true,
        },
        diffContext,
        'token',
        () => {},
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({
      agentSlug: 'security-reviewer',
      findings: [],
      costEstimateUsd: 0,
      error: 'Agent runner produced no output.',
    });
  });

  it('returns partial cost from failed agent runner commands when stdout contains a valid result', async () => {
    const { adapter } = createFakeAdapter();
    const failedCommandResult = { ...result, costEstimateUsd: 0.42 };
    adapter.runTrackedCommand = async () => ({
      exitCode: 1,
      stdout: `${JSON.stringify({ type: 'result', result: failedCommandResult })}\n`,
      stderr: 'agent crashed',
    });
    const port = createSandboxPort(adapter, {
      image: 'tribunal-reviewer:latest',
      proxyUrl: 'https://proxy.tribunal.local',
      proxyCidr: '10.0.0.8/32',
    });

    await expect(
      port.runAgent(
        'sandbox_1',
        {
          id: 'agent_1',
          agentRunId: 'agent_run_1',
          userId: 1,
          slug: 'security-reviewer',
          description: 'Find security issues',
          body: 'Review.',
          model: 'sonnet',
          enabled: true,
        },
        diffContext,
        'token',
        () => {},
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({
      agentSlug: 'security-reviewer',
      costEstimateUsd: 0.42,
      error: 'Agent runner failed with exit code 1: agent crashed',
    });
  });

  it('returns a typed failed result when failed agent runner commands do not produce a valid result', async () => {
    const { adapter } = createFakeAdapter();
    adapter.runTrackedCommand = async () => ({
      exitCode: 1,
      stdout: 'not json',
      stderr: 'agent crashed',
    });
    const port = createSandboxPort(adapter, {
      image: 'tribunal-reviewer:latest',
      proxyUrl: 'https://proxy.tribunal.local',
      proxyCidr: '10.0.0.8/32',
    });

    await expect(
      port.runAgent(
        'sandbox_1',
        {
          id: 'agent_1',
          agentRunId: 'agent_run_1',
          userId: 1,
          slug: 'security-reviewer',
          description: 'Find security issues',
          body: 'Review.',
          model: 'sonnet',
          enabled: true,
        },
        diffContext,
        'token',
        () => {},
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({
      agentSlug: 'security-reviewer',
      findings: [],
      costEstimateUsd: 0,
      error: 'Agent runner failed with exit code 1: agent crashed',
    });
  });

  it('kills the tracked process for an active agent run', async () => {
    const calls: Array<{ method: string; input: unknown }> = [];
    let finishRun: (() => void) | undefined;
    const adapter: SandboxAdapter = {
      async create() {
        throw new Error('not used');
      },
      async runCommand() {
        throw new Error('not used');
      },
      async runTrackedCommand(sandboxId, command, arguments_, _environment, onProcessStart) {
        calls.push({ method: 'runTrackedCommand', input: { sandboxId, command, arguments_ } });
        await onProcessStart('456');
        await new Promise<void>((resolve) => {
          finishRun = resolve;
        });
        return { exitCode: 0, stdout: JSON.stringify({ type: 'result', result }), stderr: '' };
      },
      async killProcess(sandboxId, processId) {
        calls.push({ method: 'killProcess', input: { sandboxId, processId } });
      },
      async suspend() {},
      async terminate() {},
    };
    const port = createSandboxPort(adapter, {
      image: 'tribunal-reviewer:latest',
      proxyUrl: 'https://proxy.tribunal.local',
      proxyCidr: '10.0.0.8/32',
    });

    const run = port.runAgent(
      'sandbox_1',
      {
        id: 'agent_1',
        agentRunId: 'agent_run_1',
        userId: 1,
        slug: 'security-reviewer',
        description: 'Find security issues',
        body: 'Review.',
        model: 'sonnet',
        enabled: true,
      },
      diffContext,
      'token',
      () => {},
      new AbortController().signal,
    );
    await waitFor(() => calls.some((call) => call.method === 'runTrackedCommand'));

    await port.stop('sandbox_1', 'agent_run_1');
    finishRun?.();
    await run;

    expect(calls).toContainEqual({
      method: 'killProcess',
      input: { sandboxId: 'sandbox_1', processId: '456' },
    });
  });

  it('kills the tracked process when stop arrives before process start is reported', async () => {
    const calls: Array<{ method: string; input: unknown }> = [];
    let finishRun: (() => void) | undefined;
    let reportProcessStart: (() => Promise<void>) | undefined;
    const adapter: SandboxAdapter = {
      async create() {
        throw new Error('not used');
      },
      async runCommand() {
        throw new Error('not used');
      },
      async runTrackedCommand(sandboxId, command, arguments_, _environment, onProcessStart) {
        calls.push({ method: 'runTrackedCommand', input: { sandboxId, command, arguments_ } });
        reportProcessStart = () => onProcessStart('789');
        await new Promise<void>((resolve) => {
          finishRun = resolve;
        });
        return { exitCode: 0, stdout: JSON.stringify({ type: 'result', result }), stderr: '' };
      },
      async killProcess(sandboxId, processId) {
        calls.push({ method: 'killProcess', input: { sandboxId, processId } });
      },
      async suspend() {},
      async terminate() {},
    };
    const port = createSandboxPort(adapter, {
      image: 'tribunal-reviewer:latest',
      proxyUrl: 'https://proxy.tribunal.local',
      proxyCidr: '10.0.0.8/32',
    });

    const run = port.runAgent(
      'sandbox_1',
      {
        id: 'agent_1',
        agentRunId: 'agent_run_1',
        userId: 1,
        slug: 'security-reviewer',
        description: 'Find security issues',
        body: 'Review.',
        model: 'sonnet',
        enabled: true,
      },
      diffContext,
      'token',
      () => {},
      new AbortController().signal,
    );
    await waitFor(() => reportProcessStart !== undefined);

    await port.stop('sandbox_1', 'agent_run_1');
    await reportProcessStart?.();
    finishRun?.();
    await run;

    expect(calls).toContainEqual({
      method: 'killProcess',
      input: { sandboxId: 'sandbox_1', processId: '789' },
    });
  });
});

async function waitFor(assertion: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (assertion()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('condition was not met');
}
